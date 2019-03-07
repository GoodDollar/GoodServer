const sgMail = {
  setApiKey: () => undefined,
  send: msg => {
    return new Promise((resolve, reject) => {
      if (msg.to === 'fake') {
        reject(new Error('Bad Request'))
      }
      resolve({})
    })
  }
}

export default sgMail
