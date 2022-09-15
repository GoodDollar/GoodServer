const tagsMap = {
  utmctr: 'term_utm',
  utmcct: 'content_utm',
  utmcsr: 'source_utm',
  utmcmd: 'medium_utm',
  utmccn: 'campaign_utm'
}

export const parseUtmString = utmString => {
  return (utmString || '').split('|').reduce((tags, record) => {
    const [name, value] = record.split('=')
    const tagValue = decodeURIComponent(value)

    if (name in tagsMap && tagValue && '(not set)' !== tagValue) {
      const mappedName = tagsMap[name]

      tags[mappedName] = tagValue
    }

    return tags
  }, {})
}

export const whenFinished = async (req, res) =>
  new Promise(resolve => {
    let finished = false
    const { log } = req

    const onAborted = () => {
      if (finished) {
        return
      }

      log.debug('Request aborted')

      res.off('finish', onFinish)
      resolve(true)
    }

    const onClose = () => {
      log.debug('Request closed', { finished })

      if (finished) {
        return
      }

      log.debug('Wait up to 30 sec for finish otherwise abort')
      setTimeout(onAborted, 30000)
    }

    const onFinish = () => {
      log.debug('Request finished')
      req.off('close', onClose)

      finished = true
      resolve(false)
    }

    res.once('finish', onFinish)
    req.once('close', onClose)
  })
