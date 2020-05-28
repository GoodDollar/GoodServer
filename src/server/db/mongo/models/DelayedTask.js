import mongoose from '../../mongo-db.js'
import { MODEL_DELAYED_TASK } from './constants'

export const DelayedTaskSchema = new mongoose.Schema({
  createdAt: {
    // date of creation (value to determine are we're ready to remove enrollment or not)
    type: Date
  },
  userIdentifier: {
    type: String
  },
  taskName: {
    // name (type, kind) of the delayed task. For 24h it should be 'verification/dispose_enrollments' (defined as constant in EnrollmentProcessor.js)
    type: String
  },
  taskSubject: {
    // some parameters (subject, options) of the task. Could be string number or object corresponding to the kind of the task.
    type: mongoose.Schema.Types.Mixed
  },
  running: {
    // running flag to solve 'sync between different backend instances' issue
    type: Boolean
  }
})

export default mongoose.model(MODEL_DELAYED_TASK, DelayedTaskSchema)
