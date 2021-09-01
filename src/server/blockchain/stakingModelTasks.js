import conf from '../server.config'
let stakingModelTasks
if (['production'].includes(conf.network)) {
  stakingModelTasks = require('./stakingModelTasksOld.js')
} else {
  stakingModelTasks = require('./stakingModelTasksV2')
}

export default stakingModelTasks
