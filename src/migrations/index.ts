import * as migration_20260904_071943_initial from './20260904_071943_initial';
import * as migration_20261008_194606_underwater_isolated_content_commerce from './20261008_194606_underwater_isolated_content_commerce';
import * as migration_20261008_195740_underwater_import_metadata from './20261008_195740_underwater_import_metadata';
import * as migration_20261008_201114_underwater_signup_confirmations from './20261008_201114_underwater_signup_confirmations';
import * as migration_20261008_202116_underwater_operations_audit from './20261008_202116_underwater_operations_audit';
import * as migration_20261008_205810_underwater_payload_security_upgrade from './20261008_205810_underwater_payload_security_upgrade';
import * as migration_20261009_004126_underwater_public_documents_contact_context from './20261009_004126_underwater_public_documents_contact_context';
import * as migration_20261009_005425_underwater_unicode_catalog_search from './20261009_005425_underwater_unicode_catalog_search';
import * as migration_20261009_010256_underwater_payment_delivery from './20261009_010256_underwater_payment_delivery';
import * as migration_20261009_051355_underwater_public_listings from './20261009_051355_underwater_public_listings';
import * as migration_20261009_070701_underwater_payment_initialization from './20261009_070701_underwater_payment_initialization';

export const migrations = [
  {
    up: migration_20260904_071943_initial.up,
    down: migration_20260904_071943_initial.down,
    name: '20260904_071943_initial',
  },
  {
    up: migration_20261008_194606_underwater_isolated_content_commerce.up,
    down: migration_20261008_194606_underwater_isolated_content_commerce.down,
    name: '20261008_194606_underwater_isolated_content_commerce',
  },
  {
    up: migration_20261008_195740_underwater_import_metadata.up,
    down: migration_20261008_195740_underwater_import_metadata.down,
    name: '20261008_195740_underwater_import_metadata',
  },
  {
    up: migration_20261008_201114_underwater_signup_confirmations.up,
    down: migration_20261008_201114_underwater_signup_confirmations.down,
    name: '20261008_201114_underwater_signup_confirmations',
  },
  {
    up: migration_20261008_202116_underwater_operations_audit.up,
    down: migration_20261008_202116_underwater_operations_audit.down,
    name: '20261008_202116_underwater_operations_audit',
  },
  {
    up: migration_20261008_205810_underwater_payload_security_upgrade.up,
    down: migration_20261008_205810_underwater_payload_security_upgrade.down,
    name: '20261008_205810_underwater_payload_security_upgrade',
  },
  {
    up: migration_20261009_004126_underwater_public_documents_contact_context.up,
    down: migration_20261009_004126_underwater_public_documents_contact_context.down,
    name: '20261009_004126_underwater_public_documents_contact_context',
  },
  {
    up: migration_20261009_005425_underwater_unicode_catalog_search.up,
    down: migration_20261009_005425_underwater_unicode_catalog_search.down,
    name: '20261009_005425_underwater_unicode_catalog_search',
  },
  {
    up: migration_20261009_010256_underwater_payment_delivery.up,
    down: migration_20261009_010256_underwater_payment_delivery.down,
    name: '20261009_010256_underwater_payment_delivery',
  },
  {
    up: migration_20261009_051355_underwater_public_listings.up,
    down: migration_20261009_051355_underwater_public_listings.down,
    name: '20261009_051355_underwater_public_listings',
  },
  {
    up: migration_20261009_070701_underwater_payment_initialization.up,
    down: migration_20261009_070701_underwater_payment_initialization.down,
    name: '20261009_070701_underwater_payment_initialization'
  },
];
