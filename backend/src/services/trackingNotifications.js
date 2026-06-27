import { sendTrackingUpdateEmail, trackingStepKey } from './emailService.js';

const hasTrackingSignal = (order = {}) => Boolean(
  order.bob_tracking_reference ||
  order.bob_tracking_status ||
  order.cj_tracking_number ||
  order.cj_status ||
  (Array.isArray(order.bob_tracking_events) && order.bob_tracking_events.length > 0)
);

export const notifyTrackingUpdateIfNeeded = async ({ previousOrder, updatedOrder, source = 'tracking' }) => {
  if (!updatedOrder?.customer_email) {
    return { success: false, skipped: true, reason: 'missing customer email' };
  }

  const previousStep = trackingStepKey(
    previousOrder?.bob_tracking_status || previousOrder?.cj_status,
    previousOrder?.status
  );
  const currentStep = trackingStepKey(
    updatedOrder?.bob_tracking_status || updatedOrder?.cj_status,
    updatedOrder?.status
  );
  const previousHadTracking = hasTrackingSignal(previousOrder);
  const currentHasTracking = hasTrackingSignal(updatedOrder);

  if (!currentHasTracking) {
    return { success: false, skipped: true, reason: 'no tracking update yet' };
  }

  if (previousHadTracking && previousStep === currentStep) {
    return { success: false, skipped: true, reason: 'tracking step unchanged' };
  }

  const result = await sendTrackingUpdateEmail({
    to: updatedOrder.customer_email,
    order: updatedOrder,
  });

  if (result.success) {
    console.log(`[tracking-email] sent from ${source}`, {
      orderNumber: updatedOrder.order_number,
      previousStep,
      currentStep,
    });
  } else {
    console.warn(`[tracking-email] failed from ${source}`, {
      orderNumber: updatedOrder.order_number,
      error: result.error,
    });
  }

  return result;
};
