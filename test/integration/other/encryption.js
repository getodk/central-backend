const appRoot = require('app-root-path');
const should = require('should');
const { testService, testContainer } = require(appRoot + '/test/integration/setup');
const testData = require(appRoot + '/test/data/xml');
const { zipStreamToFiles } = require(appRoot + '/test/util/zip');

describe('managed encryption', () => {
  describe('lock management', () => {
    it('should reject keyless forms in keyed projects @slow', testContainer(async (container) => {
      // enable managed encryption.
      await container.transacting(({ Project }) =>
        Project.getById(1).then((o) => o.get())
          .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')));

      // now attempt to create a keyless form.
      let error;
      await container.transacting(({ Project, FormPartial }) =>
        Promise.all([
          Project.getById(1).then((o) => o.get()),
          FormPartial.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
          .catch((err) => { error = err; })
      );

      error.problemCode.should.equal(409.5);
    }));

    it('should reject forms created while project managed encryption is being enabled @slow', testContainer(async (container) => {
      // enable managed encryption but don't allow the transaction to close.
      let encReq;
      const unblock = await new Promise((resolve) => {
        encReq = container.transacting(({ Project }) => Promise.all([
          Project.getById(1).then((o) => o.get())
            .then((project) => project.setManagedEncryption('supersecret', 'it is a secret')),
          new Promise(resolve)
        ]));
      });

      // now we have to wait until the above query actually takes the necessary lock.
      const lockQuery = "select count(*) from pg_locks join pg_class on pg_locks.relation = pg_class.oid where pg_class.relname = 'form_defs' and pg_locks.granted = true;";
      const locked = () => container.db.raw(lockQuery).then(({ rows }) => rows[0].count > 0);
      const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const check = () => locked().then((isLocked) => isLocked
        ? true
        : wait(10).then(check));
      await check();

      // now that we are sure the lock has been taken, try to create the form.
      let error;
      const formReq = container.transacting(({ Project, FormPartial }) =>
        Promise.all([
          Project.getById(1).then((o) => o.get()),
          FormPartial.fromXml(testData.forms.simple2)
        ])
          .then(([ project, partial ]) => partial.with({ projectId: project.id }).createNew())
          .catch((err) => { error = err; })
      );

      // now unblock the managed encryption commit and let it all flush through.
      unblock();
      await formReq;
      await encReq;

      // now make sure we get the error we wanted.
      error.problemCode.should.equal(409.5);
    }));
  });

  describe('private key retrieval', () => {
    const { generateKeypair, stripPemEnvelope } = require(appRoot + '/lib/util/crypto');
    it('should obtain the requested private keys', testService((service, { all, Key, db }) =>
      Promise.all([ 'alpha', 'beta' ].map(generateKeypair))
        .then((pairs) =>
          all.mapSequential(
            pairs.map((private) => new Key({
              public: stripPemEnvelope(Buffer.from(private.pubkey, 'base64')),
              private,
              managed: true
            }))
              .concat([ new Key({ public: 'test' }) ]),
            (k) => k.create()
          )
          .then(() => db.select('id').from('keys').then((ks) => ks.map((k) => k.id)))
          .then((ids) => Key.getPrivates({ [ids[0]]: 'alpha', [ids[1]]: 'beta' })
            .then((result) => {
              // n.b. private key extraction will fail with an exception given incorrect passphrases.
              Object.keys(result).length.should.equal(2);
              result[ids[0]].type.should.equal('private');
              result[ids[1]].type.should.equal('private');
            })))));
  });

  describe('end-to-end', () => {
    const { extractPubkey, extractVersion, sendEncrypted, internal } = require(appRoot + '/test/util/crypto-odk');

    describe('odk encryption simulation', () => {
      // because (sigh) there is so much code in crypto-odk just to simulate the
      // ODK Collect client encryption, i wouldn't feel right not.. testing.. the
      // test code....
      describe('oaep padding', () => {
        const { unpadPkcs1OaepMgf1Sha256 } = require(appRoot + '/lib/util/quarantine/oaep');
        it('should survive a round-trip', () => {
          const input = Buffer.from('0102030405060708090a0b0c0d0e0f1112131415161718191a1b1c1d1e1f2021', 'hex');
          const result = unpadPkcs1OaepMgf1Sha256(internal.padOaep(input));
          result.equals(Buffer.from('0102030405060708090a0b0c0d0e0f1112131415161718191a1b1c1d1e1f2021', 'hex'))
            .should.equal(true);
        });
      });

      describe('pkcs7 padding', () => {
        it('should pad appropriately', () => {
          internal.padPkcs7(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'))
            .equals(Buffer.from('000102030405060708090a0b0c0d0e0f10101010101010101010101010101010', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('000102030405060708090a0b0c0d0e', 'hex'))
            .equals(Buffer.from('000102030405060708090a0b0c0d0e01', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('00010203040506', 'hex'))
            .equals(Buffer.from('00010203040506090909090909090909', 'hex'))
            .should.equal(true);

          internal.padPkcs7(Buffer.from('', 'hex'))
            .equals(Buffer.from('10101010101010101010101010101010', 'hex'))
            .should.equal(true);
        });
      });
    });

    it('should decrypt to CSV successfully', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret', hint: 'it is a secret', })
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple.xml')
            .expect(200)
            .then(({ text }) => sendEncrypted(asAlice, extractVersion(text), extractPubkey(text)))
            .then((send) => send(testData.instances.simple.one)
              .then(() => send(testData.instances.simple.two))
              .then(() => send(testData.instances.simple.three)))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions/keys')
              .expect(200)
              .then(({ body }) => body[0].id))
            .then((keyId) => new Promise((done) =>
              zipStreamToFiles(asAlice.get(`/v1/projects/1/forms/simple/submissions.csv.zip?${keyId}=supersecret`), (result) => {
                result.filenames.should.eql([ 'simple.csv' ]);

                // TODO?: copied from the equivalent test in integration/api/submissions:
                const csv = result['simple.csv'].split('\n').map((row) => row.split(','));
                csv.length.should.equal(5); // header + 3 data rows + newline
                csv[0].should.eql([ 'SubmissionDate', 'meta-instanceID', 'name', 'age', 'KEY', 'SubmitterID', 'SubmitterName' ]);
                csv[1].shift().should.be.an.recentIsoDate();
                csv[1].should.eql([ 'three','Chelsea','38','three', '5', 'Alice' ]);
                csv[2].shift().should.be.an.recentIsoDate();
                csv[2].should.eql([ 'two','Bob','34','two', '5', 'Alice' ]);
                csv[3].shift().should.be.an.recentIsoDate();
                csv[3].should.eql([ 'one','Alice','30','one', '5', 'Alice' ]);
                csv[4].should.eql([ '' ]);
                done();
              })))))));
  });
});

