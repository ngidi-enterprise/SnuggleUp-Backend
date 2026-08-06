export const TRAFFIC_TYPES = Object.freeze({
  CUSTOMER: 'customer',
  SUPERUSER: 'superuser',
  ADMIN_DEVICE: 'admin_device',
  BOT: 'bot',
});

const internalTrafficTypes = new Set([
  TRAFFIC_TYPES.SUPERUSER,
  TRAFFIC_TYPES.ADMIN_DEVICE,
]);

export const classificationForTrafficType = (trafficType, userRole = null, deviceId = null) => {
  const classification = {
    trafficType,
    isInternalTraffic: internalTrafficTypes.has(trafficType),
    userRole: userRole || null,
  };
  if (deviceId) classification.deviceId = deviceId;
  return classification;
};

// Phase 1 intentionally classifies only authenticated roles and the existing,
// server-created audience records. Device and bot signals are added in later phases.
export const classifyAnalyticsTraffic = ({ access, existingAudienceType, adminDevice } = {}) => {
  if (access?.isSuperuser) {
    return classificationForTrafficType(TRAFFIC_TYPES.SUPERUSER, 'superuser');
  }

  if (access?.isProductAssistant) {
    return classificationForTrafficType(TRAFFIC_TYPES.SUPERUSER, 'product_assistant');
  }

  // The store owner requested that this registered browser continue to display
  // as superuser traffic while logged out. The device id is a database row id,
  // never the cookie token or its hash.
  if (adminDevice?.id) {
    return classificationForTrafficType(
      TRAFFIC_TYPES.SUPERUSER,
      'superuser',
      `admin-device-${adminDevice.id}`
    );
  }

  if (existingAudienceType === 'superuser') {
    return classificationForTrafficType(TRAFFIC_TYPES.SUPERUSER, 'superuser');
  }

  if (existingAudienceType === 'staff') {
    return classificationForTrafficType(TRAFFIC_TYPES.SUPERUSER, 'product_assistant');
  }

  return classificationForTrafficType(
    TRAFFIC_TYPES.CUSTOMER,
    access?.role || null
  );
};
