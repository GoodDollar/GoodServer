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
