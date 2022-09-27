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

    const onAborted = () => {
      if (finished) {
        return
      }

      res.off('finish', onFinish)
      resolve(true)
    }

    const onClose = () => {
      if (finished) {
        return
      }

      setTimeout(onAborted, 5000)
    }

    const onFinish = () => {
      req.off('close', onClose)

      finished = true
      resolve(false)
    }

    res.once('finish', onFinish)
    req.once('close', onClose)
  })
