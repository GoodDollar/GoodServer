//import { ZoomClient } from '../faceRecognition/zoomClient'

describe('faceRecognitionHelper', () => {
  let verificationData: VerificationData

  beforeAll(done => {
    verificationData = {
      sessionId: 'fake-session-id',
      enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5',
      facemapFile: './facemap.zip',
      auditTrailImageFile: './auditTrailImage.jpg',
      minMatchLevel: 0
    }

    /*let data = new FormData()
    facemap: fs.createReadStream('./facemap.zip'),
      auditTrailImage: fs.createReadStream('./auditTrailImage.jpg'),
     
    data.append('sessionId', form.sessionId)
    data.append('facemap', form.facemap, { contentType: 'application/zip' })
    data.append('auditTrailImage', form.auditTrailImage, { contentType: 'image/jpeg' })
    data.append('enrollmentIdentifier', form.enrollmentIdentifier)
    */
    done()
  })

  beforeEach(() => {
    jest.mock('../faceRecognition/zoomClient') // mock Helper
  })

  afterEach(() => {
    jest.resetModules()
  })

  test('it returns liveness=true if zoom liveness passed', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.liveness.mockResolvedValue({ meta: { ok: true }, data: { livenessResult: 'passed', livenessScore: 87 } })
    let result = await faceRecognitionHelper.isLivenessPassed(verificationData)
    expect(result).toBe(true)
  })

  test('it returns liveness=false if zoom liveness failed - livenessResult:undetermined', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.liveness.mockResolvedValue({
      meta: { ok: true },
      data: { livenessResult: 'undetermined', livenessScore: 87 }
    })
    let result = await faceRecognitionHelper.isLivenessPassed(verificationData)
    expect(result).toBe(false)
  })

  test('it returns liveness=false if zoom liveness failed - livenessScore:<=50', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.liveness.mockResolvedValue({
      meta: { ok: true },
      data: { livenessResult: 'passed', livenessScore: 49 }
    })
    let result = await faceRecognitionHelper.isLivenessPassed(verificationData)
    expect(result).toBe(false)
  })

  test('it returns liveness=false if zoom liveness failed - meta.ok:false', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.liveness.mockResolvedValue({
      meta: { ok: false },
      data: { livenessResult: 'passed', livenessScore: 78 }
    })
    let result = await faceRecognitionHelper.isLivenessPassed(verificationData)
    expect(result).toBe(false)
  })

  test('it returns duplicate=false if zoom search returned ok and empty', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.search.mockResolvedValue({
      meta: { ok: false },
      data: { results: [] }
    })
    let result = await faceRecognitionHelper.isDuplicatesExist(verificationData, verificationData.enrollmentIdentifier)
    expect(result).toBe(false)
  })

  test('it returns duplicate=false if zoom search returned ok and results without the current user enrollment', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.search.mockResolvedValue({
      meta: { ok: false },
      data: {
        results: [
          // user enrollmentIdentifier is 0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5
          { enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e3' },
          { enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e2' }
        ]
      }
    })
    let result = await faceRecognitionHelper.isDuplicatesExist(verificationData, verificationData.enrollmentIdentifier)
    expect(result).toBe(false)
  })

  test('it returns duplicate=false if zoom search returned ok and results without the current user enrollment', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    zoomClient.search.mockResolvedValue({
      meta: { ok: false },
      data: {
        results: [
          // user enrollmentIdentifier is 0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5
          { enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5' },
          { enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e3' },
          { enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e2' }
        ]
      }
    })
    let result = await faceRecognitionHelper.isDuplicatesExist(verificationData, verificationData.enrollmentIdentifier)
    expect(result).toBe(true)
  })

  test('it returns enrollment result if zoom enroll meta.ok = true', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    const expected = {
      enrollmentIdentifier: verificationData.enrollmentIdentifier,
      livenessResult: 'passed',
      livenessScore: 87,
      glassesScore: 8,
      glassesDecision: false,
      retryFeedbackSuggestion: null,
      createDate: '2017-01-01T00:00:00+00:00',
      creationStatusFromZoomServer: 'The facemap was created successfully.',
      errorFromZoomServer: null,
      facemap: ''
    }
    zoomClient.enrollment.mockResolvedValue({
      meta: { ok: true },
      data: {
        enrollmentIdentifier: verificationData.enrollmentIdentifier,
        livenessResult: 'passed',
        livenessScore: 87,
        glassesScore: 8,
        glassesDecision: false,
        retryFeedbackSuggestion: null,
        createDate: '2017-01-01T00:00:00+00:00',
        creationStatusFromZoomServer: 'The facemap was created successfully.',
        errorFromZoomServer: null,
        facemap: ''
      }
    })
    let result = await faceRecognitionHelper.enroll(verificationData)
    expect(result).toMatchObject(expected)
  })

  test('it returns alreadyEnrolled:true if zoom enroll meta.ok = false and res.meta.subCode === nameCollision', async () => {
    const faceRecognitionHelper = require('../faceRecognition/faceRecognitionHelper').default
    const zoomClient = require('../faceRecognition/zoomClient').ZoomClient
    const expected = { alreadyEnrolled: true }
    zoomClient.enrollment.mockResolvedValue({ meta: { ok: false, subCode: 'nameCollision' } })
    let result = await faceRecognitionHelper.enroll(verificationData)
    expect(result).toMatchObject(expected)
  })
})
