const { pool } = require('../db/pool');
const logger = require('../lib/logger');
const { formatPrice, formatDuration } = require('./activeCatalogueKnowledge');
const { toPublicService } = require('./publicPresentation');

async function getPublicServiceCatalogue() {
  try {
    const result = await pool.query(`
      SELECT s.id, s.name, s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
             s.price, s.display_price,
             sc.name AS category_name
        FROM services s
        LEFT JOIN service_categories sc ON sc.id = s.category_id
       WHERE s.status = 'active'
         AND EXISTS (
           SELECT 1
             FROM staff_services ss
             JOIN staff st ON st.id = ss.staff_id
            WHERE ss.service_id = s.id
              AND st.status = 'active'
              AND st.resource_type = 'practitioner'
              AND st.client_bookable = TRUE
         )
       ORDER BY
         CASE
           WHEN sc.name IN ('Massage', 'Massage Treatments') THEN 0
           WHEN sc.name = 'Pedicures & Foot Care' THEN 1
           ELSE 2
         END,
         sc.display_order NULLS LAST,
         sc.name,
         s.display_order,
         s.name
    `);

    return result.rows.map((row) =>
      toPublicService({
        id: row.id,
        name: row.name,
        category: row.category_name || 'Services',
        duration: formatDuration(row),
        price: formatPrice(row),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Could not load public service catalogue');
    return null;
  }
}

module.exports = { getPublicServiceCatalogue };
