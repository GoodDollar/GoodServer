import { values } from 'lodash'

import mongoose, { Schema, Types } from '../../mongo-db'
import { MODEL_DELAYED_TASK, MODEL_USER_PRIVATE } from './constants'

const { ObjectId, Mixed } = Types

export const DelayedTaskStatus = {
  Pending: 'pending',
  Running: 'running',
  Failed: 'failed',
  Complete: 'complete'
}

export const DelayedTaskSchema = new Schema({
  createdAt: {
    // date of creation (value to determine are we're ready to remove enrollment or not)
    type: Date,
    default: Date.now,
    index: true
  },
  userIdentifier: {
    type: ObjectId,
    ref: MODEL_USER_PRIVATE,
    required: false,
    unique: false
  },
  taskName: {
    // name (type, kind) of the delayed task. For 24h it should be 'verification/dispose_enrollments' (defined as constant in EnrollmentProcessor.js)
    type: String,
    required: true,
    index: true,
    unique: false
  },
  subject: {
    // some parameters (subject, options) of the task. Could be string number or object corresponding to the kind of the task.
    type: mongoose.Schema.Types.Mixed,
    index: true
  },
  status: {
    // running flag to solve 'sync between different backend instances' issue
    type: String,
    enum: values(DelayedTaskStatus),
    default: DelayedTaskStatus.Pending,
    index: true
  },
  lockId: {
    // lock id to implement immediately locking using two queries as findAndModify could process only one record
    type: String,
    index: true
  }
})

DelayedTaskSchema.index({ taskName: 1, status: 1 })
DelayedTaskSchema.index({ createdAt: -1, taskName: 1, status: 1 })

export default mongoose.model(MODEL_DELAYED_TASK, DelayedTaskSchema)
