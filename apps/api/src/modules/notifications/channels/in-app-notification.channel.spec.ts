import { InAppNotificationChannel } from './in-app-notification.channel';

/**
 * No failure-propagation test: `InAppNotificationChannel.deliver` performs no
 * I/O (see the class's own header comment) and has no failure branch to
 * exercise — inventing one would mean testing behavior the implementation
 * does not have. `OutboxDispatchService`'s own spec already covers how a
 * `{ delivered: false }` result from *any* `NotificationChannel` (via a stub)
 * propagates into a `FAILED` delivery row and an aborted dispatch.
 */
describe('InAppNotificationChannel', () => {
  it('reports a successful delivery for a well-formed input', async () => {
    const channel = new InAppNotificationChannel();

    const result = await channel.deliver({
      notificationId: 'notif-1',
      recipientId: 'cust-1',
      title: 'OrderCreated',
      body: null,
      deepLink: null,
    });

    expect(result).toEqual({ delivered: true });
  });

  it('identifies itself as the IN_APP channel', () => {
    const channel = new InAppNotificationChannel();

    expect(channel.channel).toBe('IN_APP');
  });
});
