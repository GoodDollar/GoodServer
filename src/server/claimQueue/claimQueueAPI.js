//@flow
import { Router } from 'express'
import passport from 'passport'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import PropsModel from '../db/mongo/models/props'
import { wrapAsync } from '../utils/helpers'

const ClaimQueue = {
  async setWhitelisted(user, storage, log) {
    //if user has passed, then we mark that in claim queue and tag the user
    return Promise.all([
      user.claimQueue && storage.updateUser({ identifier: user.identifier, 'claimQueue.status': 'whitelisted' }),
      Mautic.updateContact(user.mauticId, { tags: ['claimqueue_claimed'] }).catch(e => {
        log.error('Failed Mautic tagging  user claimed', { errMessage: e.message, e, mauticId: user.mauticId })
      }),
      Mautic.addContactsToSegment([user.mauticId], conf.mauticClaimQueueWhitelistedSegmentId).catch(e => {
        log && log.error('Failed Mautic adding user to claim queue whitelisted segment', { errMessage: e.message, e })
      })
    ])
  },

  async updateAllowed(toAdd, storage, log) {
    const fromDB = await PropsModel.findOne({ name: 'claimQueueAllowed' })
    const prevAllowed = fromDB || { value: conf.claimQueueAllowed }
    const newAllowed = prevAllowed.value + toAdd
    await PropsModel.updateOne({ name: 'claimQueueAllowed' }, { $set: { value: newAllowed } }, { upsert: true })

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
    const approvedUsers = pendingUsers.map(_ => _._id)
    const mauticIds = pendingUsers.map(_ => _.mauticId)
    Mautic.addContactsToSegment(mauticIds, conf.mauticClaimQueueApprovedSegmentId).catch(e => {
      log.error('Failed Mautic adding user to claim queue approved segment', { errMessage: e.message, e })
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
          log.error('Failed Mautic tagging  user inqueue', { errMessage: e.message, e, mauticId: user.mauticId })
        })
        Mautic.addContactsToSegment([user.mauticId], conf.mauticClaimQueueSegmentId).catch(e => {
          log.error('Failed Mautic adding user to claim queue segment', {
            errMessage: e.message,
            e,
            mauticId: user.mauticId
          })
        })
      } else {
        Mautic.updateContact(user.mauticId, { tags: ['claimqueue_autoapproved'] }).catch(e => {
          log.error('Failed Mautic tagging  user autoapproved', { errMessage: e.message, e, mauticId: user.mauticId })
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
    wrapAsync(async (req, res, next) => {
      const { body, log } = req
      if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
      const toAdd = body.allow
      const result = await ClaimQueue.updateAllowed(toAdd, storage, log)
      res.json(result)
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
      const { user, log, isE2ERunning } = req
      const { claimQueueAllowed } = conf

      // if queue is enabled and we're not running cypress tests, enqueueing user
      if (claimQueueAllowed > 0 && !isE2ERunning) {
        const queueStatus = await ClaimQueue.enqueue(user, storage, log)

        res.json(queueStatus)
        return
      }

      log.debug('claimqueue: skip', { claimQueueAllowed, isE2ERunning })
      res.json({ ok: 1, queue: { status: 'verified' } })
    })
  )
}
export default setup

export { ClaimQueue }
