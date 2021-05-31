export const ZoomAPIError = {
  FacemapNotFound: 'facemapNotFound',
  FacemapDoesNotMatch: 'facemapNotMatch',
  LivenessCheckFailed: 'livenessCheckFailed',
  SecurityCheckFailed: 'securityCheckFailed',
  NameCollision: 'nameCollision',
  HttpException: 'httpException',
  UnexpectedException: 'unexpectedException'
}

export const ZoomLicenseType = {
  Browser: 'web',
  Mobile: 'native'
}

export const failedEnrollmentMessage = 'FaceMap could not be enrolled'
export const failedLivenessMessage = 'Liveness could not be determined'
export const failedMatchMessage = 'FaceMap could not be 3D-matched and updated'
export const enrollmentNotFoundMessage = 'An enrollment does not exists for this enrollment identifier'
export const enrollmentAlreadyExistsMessage = 'An enrollment already exists for this enrollment identifier'

export const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`
export const successfullyEnrolledMessage = 'The FaceMap was successfully enrolled.'
export const alreadyEnrolledMessage = 'The FaceMap was already enrolled.'
