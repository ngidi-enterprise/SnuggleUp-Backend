import express from 'express';

export const router = express.Router();

const FREE_DELIVERY_CODE = 'FREEDELIVERY';

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

router.post('/apply', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const orderAmount = roundMoney(req.body?.orderAmount);
  const shippingAmount = roundMoney(req.body?.shippingAmount);

  if (!code) {
    return res.status(400).json({ applied: false, error: 'Enter a discount code' });
  }

  if (code !== FREE_DELIVERY_CODE) {
    return res.status(404).json({ applied: false, error: 'Invalid discount code' });
  }

  if (shippingAmount <= 0) {
    return res.status(400).json({
      applied: false,
      error: 'This code only applies when there is a delivery fee'
    });
  }

  const discountValue = Math.min(shippingAmount, orderAmount);

  return res.json({
    applied: true,
    code: FREE_DELIVERY_CODE,
    type: 'free_delivery',
    discountValue,
    discountAmount: discountValue,
    message: 'Free delivery applied'
  });
});
