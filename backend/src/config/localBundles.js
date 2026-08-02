export const LOCAL_BUNDLES = [
  {
    id: 'daily-essentials',
    name: 'Daily Essentials Kit',
    eyebrow: 'A simpler start',
    description: 'Three everyday changing essentials chosen to make the early days feel a little easier.',
    saving: 18,
    productIds: [4, 17, 30],
  },
  {
    id: 'bath-time',
    name: 'Gentle Bath Time Trio',
    eyebrow: 'Bath time, sorted',
    description: 'A practical trio for washing, moisturising and keeping delicate skin comfortable.',
    saving: 10,
    productIds: [21, 28, 29],
  },
];

export const calculateBundleDiscount = (selections = [], localOrderItems = []) => {
  const quantitiesByProductId = new Map();

  for (const item of localOrderItems) {
    const productId = Number.parseInt(item?.id, 10);
    if (!Number.isFinite(productId)) continue;
    const quantity = Math.max(0, Number(item?.quantity || 0));
    quantitiesByProductId.set(
      productId,
      (quantitiesByProductId.get(productId) || 0) + quantity
    );
  }

  const requestedByBundleId = new Map();
  for (const selection of Array.isArray(selections) ? selections : []) {
    const bundleId = String(selection?.id || '');
    const quantity = Math.max(0, Math.floor(Number(selection?.quantity || 0)));
    if (!bundleId || quantity === 0) continue;
    requestedByBundleId.set(
      bundleId,
      (requestedByBundleId.get(bundleId) || 0) + quantity
    );
  }

  let discount = 0;
  const validatedSelections = [];

  for (const bundle of LOCAL_BUNDLES) {
    const requestedQuantity = requestedByBundleId.get(bundle.id) || 0;
    if (requestedQuantity === 0) continue;

    const availableSets = Math.min(
      ...bundle.productIds.map(productId => quantitiesByProductId.get(productId) || 0)
    );
    const validQuantity = Math.min(requestedQuantity, availableSets);
    if (validQuantity === 0) continue;

    discount += bundle.saving * validQuantity;
    validatedSelections.push({ id: bundle.id, quantity: validQuantity });

    for (const productId of bundle.productIds) {
      quantitiesByProductId.set(
        productId,
        (quantitiesByProductId.get(productId) || 0) - validQuantity
      );
    }
  }

  return {
    discount: Math.round(discount * 100) / 100,
    selections: validatedSelections,
  };
};
