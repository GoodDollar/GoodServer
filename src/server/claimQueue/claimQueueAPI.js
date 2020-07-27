//@flow
import { Router } from 'express'
import passport from 'passport'
import { map } from 'lodash'

import { Mautic } from '../mautic/mauticAPI'
import { ClaimQueueProps } from '../db/mongo/models/props'

import conf from '../server.config'
import { wrapAsync } from '../utils/helpers'

const ClaimQueue = {
  async setWhitelisted(user, storage, log) {
    //if user has passed, then we mark that in claim queue and tag the user
    return Promise.all([
      user.claimQueue && storage.updateUser({ identifier: user.identifier, 'claimQueue.status': 'whitelisted' }),
      Mautic.updateContact(user.mauticId, { tags: ['claimqueue_claimed'] }).catch(e => {
        log.error('Failed Mautic tagging  user claimed', e.message, e, { mauticId: user.mauticId })
      }),
      Mautic.addContactsToSegment([user.mauticId], conf.mauticClaimQueueWhitelistedSegmentId).catch(e => {
        log && log.error('Failed Mautic adding user to claim queue whitelisted segment', e.message, e)
      })
    ])
  },

  async getStatistics(storage) {
    var agg = [
      {
        $match: {
          'claimQueue.status': { $exists: 1 }
        }
      },
      {
        $group: {
          _id: '$claimQueue.status',
          total: { $sum: 1 }
        }
      }
    ]

    const stats = await storage.model.aggregate(agg)
    return stats.map(pair => ({ [pair._id]: pair.total }))
  },

  async updateAllowed(toAdd, storage, log) {
    const { claimQueueAllowed } = conf
    let queueProps = await ClaimQueueProps.findOne({})

    if (!queueProps) {
      queueProps = new ClaimQueueProps({ value: claimQueueAllowed })
    }

    queueProps.value += toAdd
    await queueProps.save()

    const newAllowed = queueProps.value
    const totalPending = await storage.model.count({ 'claimQueue.status': 'pending' })
    const stillPending = totalPending - toAdd

    const pendingUsers = await storage.model
      .find(
        { 'claimQueue.status': 'pending' },
        { mauticId: 1, 'claimQueue.date': 1, identifier: 1 },
        {
          sort: { 'claimQueue.date': 1 }, //get first in queue first
          limit: toAdd
        }
      )
      .lean()

    const approvedUsers = map(pendingUsers, '_id')
    const mauticIds = map(pendingUsers, 'mauticId')

    Mautic.addContactsToSegment(mauticIds, conf.mauticClaimQueueApprovedSegmentId).catch(e => {
      log.error('Failed Mautic adding user to claim queue approved segment', e.message, e)
    })

    await storage.model.updateMany({ _id: { $in: approvedUsers } }, { $set: { 'claimQueue.status': 'approved' } })

    log.debug('claim queue updated', { pendingUsers, newAllowed, stillPending })
    return { ok: 1, newAllowed, stillPending, approvedUsers: pendingUsers }
  },

  async enqueue(user, storage, log) {
    const { claimQueueAllowed } = conf
    const { claimQueue } = user

    log.debug('claimqueue:', { allowed: claimQueueAllowed, queue: claimQueue })

    // if user already in queue or user already whitelisted we skip adding to queue
    if (claimQueue) {
      return { ok: 0, queue: claimQueue }
    }

    const totalQueued = await storage.model.count({ 'claimQueue.status': { $exists: true } })
    const openSpaces = claimQueueAllowed - totalQueued
    let status = openSpaces > 0 ? 'approved' : 'pending'

    //if user was added to queue tag him in mautic
    if (['test', 'development'].includes(conf.env) === false && user.mauticId) {
      if (status === 'pending') {
        Mautic.updateContact(user.mauticId, { tags: ['claimqueue_in'] }).catch(e => {
          log.error('Failed Mautic tagging  user inqueue', e.message, e, { mauticId: user.mauticId })
        })
        Mautic.addContactsToSegment([user.mauticId], conf.mauticClaimQueueSegmentId).catch(e => {
          log.error('Failed Mautic adding user to claim queue segment', e.message, e, { mauticId: user.mauticId })
        })
      } else {
        Mautic.updateContact(user.mauticId, { tags: ['claimqueue_autoapproved'] }).catch(e => {
          log.error('Failed Mautic tagging  user autoapproved', e.message, e, { mauticId: user.mauticId })
        })
      }
    }

    storage.updateUser({ identifier: user.identifier, claimQueue: { status, date: Date.now() } })

    return { ok: 1, queue: { status, date: Date.now() } }
  }
}

const setup = (app: Router, storage: StorageAPI) => {
  app.post(
    '/admin/queue',
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { allow, password } = body

      try {
        if (password !== conf.gundbPassword) {
          throw new Error("GunDB password doesn't match.")
        }

        const result = await ClaimQueue.updateAllowed(allow, storage, log)

        res.json(result)
      } catch (exception) {
        const { message } = exception

        log.error('Error processing claim queue:', message, exception)
        res.json({ ok: 0, error: message })
      }
    })
  )

  app.get(
    '/admin/queue',
    wrapAsync(async (req, res) => {
      const { log } = req

      try {
        const result = await ClaimQueue.getStatistics(storage)

        res.json(result)
      } catch (exception) {
        const { message } = exception

        log.error('Error processing claim queue statistics:', message, exception)
        res.json({ ok: 0, error: message })
      }
    })
  )

  /**
   * @api {post} /user/enqueue Puts user in claim queue for phase1
   * @apiName Enqueue
   * @apiGroup Storage
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {String} status
   * @ignore
   */
  app.post(
    '/user/enqueue',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, log } = req
      const { claimQueueAllowed } = conf

      // if queue is enabled, enqueueing user
      if (claimQueueAllowed > 0) {
        const queueStatus = await ClaimQueue.enqueue(user, storage, log)

        res.json(queueStatus)
        return
      }

      log.debug('claimqueue: skip', { claimQueueAllowed })
      res.json({ ok: 1, queue: { status: 'verified' } })
    })
  )
}
export default setup

export { ClaimQueue }
