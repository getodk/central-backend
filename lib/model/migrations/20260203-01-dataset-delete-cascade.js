// Copyright 2026 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const up = async (db) => {
  await db.raw(`
    ALTER TABLE public.entities DROP CONSTRAINT entities_datasetid_foreign;
    ALTER TABLE public.entities ADD CONSTRAINT entities_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id) ON DELETE CASCADE;
  `);

  // any reason to set null instead of cascade? dont need properties w/o datasets.
  await db.raw(`
    ALTER TABLE public.ds_properties DROP CONSTRAINT ds_properties_datasetid_foreign;
    ALTER TABLE public.ds_properties ADD CONSTRAINT ds_properties_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id) ON DELETE CASCADE;
  `);

  await db.raw(`
    ALTER TABLE public.ds_property_fields DROP CONSTRAINT ds_property_fields_dspropertyid_foreign;
    ALTER TABLE public.ds_property_fields ADD CONSTRAINT ds_property_fields_dspropertyid_foreign FOREIGN KEY ("dsPropertyId") REFERENCES public.ds_properties(id) ON DELETE CASCADE;
  `);

  await db.raw(`
    ALTER TABLE public.dataset_form_defs DROP CONSTRAINT dataset_form_defs_datasetid_foreign;
    ALTER TABLE public.dataset_form_defs ADD CONSTRAINT dataset_form_defs_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id) ON DELETE CASCADE;
  `);

  await db.raw(`
    ALTER TABLE public.form_attachments DROP CONSTRAINT form_attachments_datasetid_foreign;
    ALTER TABLE public.form_attachments ADD CONSTRAINT form_attachments_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id) ON DELETE SET NULL;
  `);
};

const down = async (db) => {
  await db.raw(`
    ALTER TABLE public.entities DROP CONSTRAINT entities_datasetid_foreign;
    ALTER TABLE public.entities ADD CONSTRAINT entities_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);
  `);

  await db.raw(`
    ALTER TABLE public.ds_properties DROP CONSTRAINT ds_properties_datasetid_foreign;
    ALTER TABLE public.ds_properties ADD CONSTRAINT ds_properties_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);
  `);

  await db.raw(`
    ALTER TABLE public.ds_property_fields DROP CONSTRAINT ds_property_fields_dspropertyid_foreign;
    ALTER TABLE public.ds_property_fields ADD CONSTRAINT ds_property_fields_dspropertyid_foreign FOREIGN KEY ("dsPropertyId") REFERENCES public.ds_properties(id);
  `);

  await db.raw(`
    ALTER TABLE public.dataset_form_defs DROP CONSTRAINT dataset_form_defs_datasetid_foreign;
    ALTER TABLE public.dataset_form_defs ADD CONSTRAINT dataset_form_defs_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);
  `);

  await db.raw(`
    ALTER TABLE public.form_attachments DROP CONSTRAINT form_attachments_datasetid_foreign;
    ALTER TABLE public.form_attachments ADD CONSTRAINT form_attachments_datasetid_foreign FOREIGN KEY ("datasetId") REFERENCES public.datasets(id);
  `);
};

module.exports = { up, down };
