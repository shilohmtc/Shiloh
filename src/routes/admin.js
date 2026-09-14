const express = require('express');

const router = express.Router();

router.use((req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'Legacy admin API retired',
    code: 'SHILOH_LEGACY_ADMIN_API_RETIRED',
    requestId: req.id,
  });
});

module.exports = router;
