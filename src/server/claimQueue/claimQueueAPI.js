//@flow
import { Router } from 'express'
import { body } from 'express-validator'
import passport from 'passport'
import { map, get } from 'lodash'
import { sha3 } from 'web3-utils'
import moment from 'moment'

import { Mautic } from '../mautic/mauticAPI'
import { ClaimQueueProps } from '../db/mongo/models/props'

import conf from '../server.config'
import { wrapAsync } from '../utils/helpers'
import logger from '../../imports/logger'

const defaultLogger = logger.child({ from: 'ClaimQueue ' })

const ClaimQueue = {
  async setWhitelisted(user, storage, log = defaultLogger) {
    const { mauticClaimQueueWhitelistedSegmentId } = conf
    const { identifier, mauticId, claimQueue } = user
    let result = Promise.resolve()

    if (claimQueue) {
      result = storage.updateUser({ identifier, 'claimQueue.status': 'whitelisted' })
    }

    // Mautic calls could took a lot of time and cause FaceTec timeout
    // so let's do it 'in background'
    // also we won't call mautic if user.mauticId is empty or null
    if (mauticId) {
      Mautic.updateContact(mauticId, { tags: ['claimqueue_claimed'] }).catch(exception => {
        const { message } = exception

        log.error('Failed Mautic tagging user claimed', message, exception, { mauticId })
      })

      Mautic.addContactsToSegment([mauticId], mauticClaimQueueWhitelistedSegmentId).catch(exception => {
        const { message } = exception

        log.error('Failed Mautic adding user to claim queue whitelisted segment', message, exception)
      })
    }

    return result
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

    const [queueProps, stats] = await Promise.all([ClaimQueueProps.findOne({}).lean(), storage.model.aggregate(agg)])

    const result = {}
    stats.forEach(pair => (result[pair._id] = pair.total))
    result['allowed'] = queueProps.value
    return result
  },

  async updateAllowed(toAdd, storage, log = defaultLogger) {
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

  async updateAllowedEmails(emailsToApprove: Array<string>, storage, log = defaultLogger) {
    const { claimQueueAllowed } = conf
    const emailsHashes = map(emailsToApprove, sha3)
    const approvedUsers = await storage.model
      .find(
        {
          email: { $in: emailsHashes },
          $or: [
            { 'claimQueue.status': { $nin: ['approved', 'whitelisted'] } },
            { 'claimQueue.status': { $exists: false } }
          ]
        },
        { mauticId: 1, identifier: 1 }
      )
      .lean()

    //update the global allowed so approved by email users dont take existing open spots
    let queueProps = await ClaimQueueProps.findOne({})
    if (!queueProps) {
      queueProps = new ClaimQueueProps({ value: claimQueueAllowed })
    }
    queueProps.value += approvedUsers.length
    await queueProps.save()

    const userIds = map(approvedUsers, '_id')
    const mauticIds = map(approvedUsers, 'mauticId')

    Mautic.addContactsToSegment(mauticIds, conf.mauticClaimQueueApprovedSegmentId).catch(e => {
      log.error('Failed Mautic adding user to claim queue approved segment', e.message, e)
    })

    await storage.model.updateMany({ _id: { $in: userIds } }, { $set: { 'claimQueue.status': 'approved' } })

    log.debug('claim queue updated', { approvedUsers })
    return { ok: 1, approvedUsers }
  },

  async enqueue(user, storage, log = defaultLogger) {
    const { claimQueueAllowed: claimQueueAllowedDefault } = conf

    let queueProps = await ClaimQueueProps.findOne({}).lean()
    const claimQueueAllowed = get(queueProps, 'value', claimQueueAllowedDefault)
    const { claimQueue } = user

    log.debug('claimqueue:', { allowed: claimQueueAllowed, queue: claimQueue })

    // if user already in queue or user already whitelisted we skip adding to queue
    if (claimQueue) {
      return { ok: 0, queue: claimQueue }
    }

    const totalQueued = await storage.model.count({ 'claimQueue.status': { $exists: true } })
    const openSpaces = claimQueueAllowed - totalQueued
    let status = openSpaces > 0 ? 'approved' : 'pending'

    // if user was added to queue tag him in mautic
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

    const now = Date.now()

    storage.updateUser({ identifier: user.identifier, claimQueue: { status, date: now } })

    return { ok: 1, queue: { status, date: moment(now).toISOString() } }
  }
}

const setup = (app: Router, storage: StorageAPI) => {
  app.post(
    '/admin/queue',
    body('allow')
      .isInt()
      .toInt(), // check is 'allow' an integer, explicitly cast if not
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { allow, password, emails } = body

      try {
        if (password !== conf.gundbPassword) {
          throw new Error("GunDB password doesn't match.")
        }

        let result
        if (emails) {
          result = await ClaimQueue.updateAllowedEmails(emails, storage, log)
        } else {
          result = await ClaimQueue.updateAllowed(allow, storage, log)
        }

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
        const defaults = { whitelisted: 0, approved: 0, allowed: 0 }
        let result = await ClaimQueue.getStatistics(storage)
        res.json({ ...defaults, ...result })
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
        log.debug('enqueue user result:', { queueStatus, user })
        res.json(queueStatus)
        return
      }

      log.debug('claimqueue: skip', { claimQueueAllowed })
      res.json({ ok: 1, queue: { status: 'whitelisted' } })
    })
  )
}
export default setup

export { ClaimQueue }
