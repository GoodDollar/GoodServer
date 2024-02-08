const defaultTransformValue = (_, value) => value

export const substituteParams = (request, transformValue = defaultTransformValue) => {
  const { url, params } = request
  const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || {})

  const substituteParameter = (_, parameter) => {
    const parameterValue = transformValue(parameter, searchParams.get(parameter))

    searchParams.delete(parameter)
    return encodeURIComponent(parameterValue)
  }

  return {
    ...request,
    params: searchParams,
    url: (url || '').replace(/:(\w[\w\d]+)/g, substituteParameter)
  }
}
