import { ZoomAPIError } from './constants'

const logAsErrors = [ZoomAPIError.HttpException, ZoomAPIError.UnexpectedException]

export const enrollmentIdFields = ['enrollmentIdentifier', 'externalDatabaseRefID', 'identifier']
export const faceSnapshotFields = ['sessionId', 'faceScan', 'auditTrailImage', 'lowQualityAuditTrailImage']
export const idscanFields = ['idScan', 'idScanFrontImage', 'idScanBackImage']
export const redactFieldsDuringLogging = ['faceMapBase64', 'auditTrailBase64', ...faceSnapshotFields, ...idscanFields]

export const shouldLogVerificaitonError = exception => logAsErrors.includes(exception.name)
