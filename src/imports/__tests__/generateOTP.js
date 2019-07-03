/**
 * @jest-environment node
 */

import { generateOTP } from '../otp'

describe('generateOTP positive values', () => {
  // Given
  const lengths = [1, 2, 3, 4, 5, 10]

  lengths.forEach(length => {
    it(`should generate an OTP code of ${length} chars for length = ${length}`, () => {
      // When
      const otp = generateOTP(length)

      // Then
      expect(otp.length).toBe(length)
    })
  })
})

describe('generateOTP negative values and zero', () => {
  // Given
  const lengths = [-10, -2, -1, 0]

  lengths.forEach(length => {
    it(`should generate an OTP equal to '0' for: ${length}`, () => {
      // When
      const otp = generateOTP(length)

      // Then
      expect(otp.length).toBe(1)
      expect(otp).toBe('0')
    })
  })
})
