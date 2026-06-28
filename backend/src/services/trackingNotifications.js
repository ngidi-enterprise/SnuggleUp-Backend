import { sendTrackingUpdateEmail, trackingStepKey } from './emailService.js';
import { sendTrackingSms } from './winsmsService.js';

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

  const emailResult = await sendTrackingUpdateEmail({
    to: updatedOrder.customer_email,
    order: updatedOrder,
  });

  if (emailResult.success) {
    console.log(`[tracking-email] sent from ${source}`, {
      orderNumber: updatedOrder.order_number,
      previousStep,
      currentStep,
    });
  } else {
    console.warn(`[tracking-email] failed from ${source}`, {
      orderNumber: updatedOrder.order_number,
      error: emailResult.error,
    });
  }

  const smsResult = await sendTrackingSms({
    order: updatedOrder,
    currentStep,
  });

  if (smsResult.success) {
    console.log(`[tracking-sms] sent from ${source}`, {
      orderNumber: updatedOrder.order_number,
      currentStep,
      mobileNumber: smsResult.mobileNumber,
      creditCost: smsResult.creditCost,
    });
  } else if (smsResult.skipped) {
    console.log(`[tracking-sms] skipped from ${source}`, {
      orderNumber: updatedOrder.order_number,
      reason: smsResult.reason,
    });
  } else {
    console.warn(`[tracking-sms] failed from ${source}`, {
      orderNumber: updatedOrder.order_number,
      error: smsResult.error,
    });
  }

  return {
    success: emailResult.success || smsResult.success,
    email: emailResult,
    sms: smsResult,
  };
};
