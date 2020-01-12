import logger from '../src/imports/logger'
const log = logger.child({ from: 'Plivo Mock' })

function Client(authId, authToken) {
  this.messages = {
    create: function(plivoNumber, to, text) {
      return new Promise((resolve, reject) => {
        if (to === 'fake') {
          log.info('messages.create -> error', { plivoNumber, to, text })
          reject(new Error('Bad Request'))
        }
        log.info('messages.create', { plivoNumber, to, text })
        resolve({
          id: ['0abf5944-4027-11e9-ac87-0625cd561840'],
          apiId: '0abe19e4-4027-11e9-ac87-0625cd561840',
          message: 'message(s) queued',
          messageUuid: ['0abf5944-4027-11e9-ac87-0625cd561840']
        })
      })
    }
  }
}

export { Client }
