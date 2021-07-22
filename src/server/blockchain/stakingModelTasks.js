import conf from '../server.config'
let stakingModelTasks
if (['staging', 'production'].includes(conf.network)) {
  stakingModelTasks = require('./stakingModelTasksOld.js')
} else {
  stakingModelTasks = require('./stakingModelTasksV2')
}

module.exports = stakingModelTasks
