import OnGage from '../crm/ongage'
import addUserSteps from '../storage/addUserSteps'

export const syncUserEmail = async (user, email, utmString, log) => {
  const { crmId } = user

  if (!crmId) {
    const userPayload = { ...user, email }

    log.debug("crm contact doesn't exists creating...")
    await addUserSteps.createCRMRecord(userPayload, utmString, log)
    return
  }

  log.debug('crm contact exists updating...')
  await OnGage.updateContactEmail(crmId, email, log)
}
