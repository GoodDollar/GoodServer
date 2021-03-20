export const ZoomAPIError = {
  FacemapNotFound: 'facemapNotFound',
  FacemapDoesNotMatch: 'facemapNotMatch',
  LivenessCheckFailed: 'livenessCheckFailed',
  SecurityCheckFailed: 'securityCheckFailed',
  NameCollision: 'nameCollision',
  HttpException: 'httpException',
  UnexpectedException: 'unexpectedException'
}

const logAsErrors = [ZoomAPIError.HttpException, ZoomAPIError.UnexpectedException]

export const failedEnrollmentMessage = 'FaceMap could not be enrolled'
export const failedLivenessMessage = 'Liveness could not be determined'
export const failedMatchMessage = 'FaceMap could not be 3D-matched and updated'
export const enrollmentNotFoundMessage = 'An enrollment does not exists for this enrollment identifier'
export const enrollmentAlreadyExistsMessage = 'An enrollment already exists for this enrollment identifier'

export const enrollmentIdFields = ['enrollmentIdentifier', 'externalDatabaseRefID', 'identifier']
export const faceSnapshotFields = ['sessionId', 'faceScan', 'auditTrailImage', 'lowQualityAuditTrailImage']
export const redactFieldsDuringLogging = ['faceMapBase64', 'auditTrailBase64', ...faceSnapshotFields]

export const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`
export const successfullyEnrolledMessage = 'The FaceMap was successfully enrolled.'
export const alreadyEnrolledMessage = 'The FaceMap was already enrolled.'

export const logException = (logger, label, message, exception, data) => {
  const loggerMethod = logAsErrors.includes(exception.name) ? 'error' : 'warn'

  logger[loggerMethod](label, message, exception, data)
}
