const DECIMALS = 2

/**
 * convert gooddollars to wei (0 decimals) use toFixed to overcome javascript precision issues ie 8.95*Math.pow(0.1,2)=8.9500000001
 * @param {string} gd
 * @returns {string}
 */
export default gd => (gd * Math.pow(10, DECIMALS)).toFixed(0)
