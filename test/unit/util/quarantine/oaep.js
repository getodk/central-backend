require('should');
const appRoot = require('app-root-path');
// eslint-disable-next-line import/no-dynamic-require
const { unpadPkcs1OaepMgf1Sha256 } = require(appRoot + '/lib/util/quarantine/oaep');

describe('crypto: oeap decoding', () => {
  it('decodes a known value correctly', () => {
    const input = Buffer.from('AF1qXO15ubG0LaA1cg/7ZIR4KMMJjvSajKnaO9XdW17ebdihy1uxHGuUsXhufc44U8rFnsNkSDkjYj1n/GYs1Q1gypvVHmBULMfEp4XlzImlIPCQWe7WX2vLdIEZ+kKSI+sLqi/qMA9edfYUbUe3bgkar46drbDb2UAAUmR+9kX8fe4aNC69JW6yOvIFBEWDcN0F6WhzL0Uk6sWG/4fTwWcZ93Fn04phFHhN8OP+VGjDrp8PUnUckChVprXI5OESscdcwjtHPKDzP5/R8fvjFutrFk3ADY9qR89JniHDBmxz3cR4OC4zpXlSkDyPMhb8wN12179+IR6tSHT9S7xznw==', 'base64');
    const expected = Buffer.from('W/Omu2zF3T87S97V5ninlQNrxQsyAFe4C5iiQrPp9r8=', 'base64');
    unpadPkcs1OaepMgf1Sha256(input).equals(expected).should.equal(true);
  });
});

