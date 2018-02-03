const up = (knex, Promise) => {
  const createBlobs = knex.schema.createTable('blobs', (blobs) => {
    blobs.increments('id');
    blobs.string('sha', 40).notNull().unique();
    blobs.binary('content').notNull();
    blobs.text('contentType');

    blobs.index('sha');
  });
  const createSubmissionsJoin = knex.schema.createTable('attachments', (sb) => {
    sb.integer('submissionId').notNull();
    sb.integer('blobId').notNull();
    sb.text('name').notNull();

    sb.primary([ 'submissionId', 'name' ]);

    sb.foreign('submissionId').references('submissions.id');
    sb.foreign('blobId').references('blobs.id');

    sb.index([ 'submissionId' ]);
  });

  return Promise.all([ createBlobs, createSubmissionsJoin ]);
};

const down = (knex, Promise) => Promise.all([
  knex.schema.dropTable('attachments'),
  knex.schema.dropTable('blobs')
]);

module.exports = { up, down };

