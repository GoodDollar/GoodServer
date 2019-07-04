describe('verification', () => {
  let user
  let verificationData

  beforeAll(done => {
    verificationData = {
      sessionId: 'fake-session-id',
      enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5',
      facemapFile: './facemap.zip',
      auditTrailImageFile: './auditTrailImage.jpg'
    }

    user = { identifier: 1, fullName: 'hadar', email: 'hadarbe@gooddollar.org' }
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
    jest.mock('../faceRecognition/faceRecognitionHelper') // mock Helper
  })

  afterEach(() => {
    jest.resetModules()
  })

  test('Helper mocked succesfully', () => {
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    // console.log('helper', { Helper })
    expect(Helper.prepareLivenessData.mock).toBeTruthy()
    expect(Helper.prepareSearchData.mock).toBeTruthy()
    expect(Helper.isDuplicatesExist.mock).toBeTruthy()
  })

  test('it doesnt throw error', async () => {
    const verification = require('../verification').default
    expect(() => {
      verification.verifyUser(user, verificationData).not.toThrow()
    })
  })

  test('it calls prepareSearchData', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    verification.verifyUser(user, verificationData)
    expect(Helper.prepareSearchData).toBeCalledTimes(1)
  })

  test('it calls isDuplicatesExist', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    verification.verifyUser(user, verificationData)
    expect(Helper.isDuplicatesExist).toBeCalledTimes(1)
  })

  test('it returns { ok: 1, livenessPassed: true, isDuplicatesExist: true} if Helper.isDuplicatesExist=true', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    Helper.isLivenessPassed.mockResolvedValue(true)
    Helper.isDuplicatesExist.mockResolvedValue(true)
    const res = await verification.verifyUser(user, verificationData)
    expect(res).toMatchObject({ ok: 1, isDuplicate: true })
  })

  test('it calls prepareEnrollmentData & enroll if liveness=true and isDuplicate=false', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    Helper.isLivenessPassed.mockResolvedValue(true)
    Helper.isDuplicatesExist.mockResolvedValue(false)
    Helper.enroll.mockResolvedValue({ alreadyEnrolled: true })
    const res = await verification.verifyUser(user, verificationData)
    expect(Helper.prepareEnrollmentData).toBeCalledTimes(1)
  })

  test('it returns isVerified = true if liveness=true and isDuplicate=false and user was already enrolled', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    Helper.isLivenessPassed.mockResolvedValue(true)
    Helper.isDuplicatesExist.mockResolvedValue(false)
    Helper.enroll.mockResolvedValue({ alreadyEnrolled: true })
    const res = await verification.verifyUser(user, verificationData)
    expect(res).toMatchObject({ ok: 1, isVerified: true })
  })

  test('it returns isVerified = true if liveness=true and isDuplicate=false and user was enrolled successfully', async () => {
    const verification = require('../verification').default
    const Helper = require('../faceRecognition/faceRecognitionHelper').default
    Helper.isLivenessPassed.mockResolvedValue(true)
    Helper.isDuplicatesExist.mockResolvedValue(false)
    console.log('enrollmentIdentifier', verificationData.enrollmentIdentifier)
    Helper.enroll.mockResolvedValue({ enrollmentIdentifier: verificationData.enrollmentIdentifier })
    console.log({ verificationData })
    const res = await verification.verifyUser(user, verificationData)
    expect(res).toMatchObject({
      ok: 1,
      isVerified: true,
      enrollResult: { enrollmentIdentifier: verificationData.enrollmentIdentifier }
    })
  })
})

//const mock = jest.spyOn(Helper, 'prepareLivenessData')
//Helper = jest.genMockFromModule('../faceRecognition/faceRecognitionHelper').default
//Helper.prepareLivenessData.mockResolvedValue(form)
//expect(mock).toBeCalledTimes(1)
