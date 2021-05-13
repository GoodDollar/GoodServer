import { ZoomAPIError } from './constants'

const logAsErrors = [ZoomAPIError.HttpException, ZoomAPIError.UnexpectedException]

export const enrollmentIdFields = ['enrollmentIdentifier', 'externalDatabaseRefID', 'identifier']
export const faceSnapshotFields = ['sessionId', 'faceScan', 'auditTrailImage', 'lowQualityAuditTrailImage']
export const redactFieldsDuringLogging = ['faceMapBase64', 'auditTrailBase64', ...faceSnapshotFields]

export const shouldLogVerificaitonError = exception => logAsErrors.includes(exception.name)
