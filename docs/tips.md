# Tips

These examples can be pasted into the PHP code field after selecting `pimcore:run-script`.
Keep the arguments/options field set to `[]`.

## Notify all active users

Use this script to send a Studio notification, for example before planned maintenance.
It sends one notification to each active Pimcore user with the `notifications` permission.
Running it again sends another notification to those users.

**Active accounts are not the same as currently logged-in users.** This script does not filter by
online status: offline users can read the notification when they next open Studio.
The user's `lastLogin` timestamp does not reliably indicate whether they are still logged in.

```php
<?php

$users = new \Pimcore\Model\User\Listing();
$users->setCondition('active = ?', [1]);

$count = 0;

foreach ($users->load() as $user) {
    if (!$user instanceof \Pimcore\Model\User
        || !$user->isAllowed('notifications')) {
        continue;
    }

    $notification = new \Pimcore\Model\Notification();
    $notification->setRecipient($user);
    $notification->setSender(null);
    $notification->setTitle('Maintenance notice');
    $notification->setMessage('Maintenance will begin shortly. Please save your work.');
    $notification->save();

    $count++;
}

echo "Notification sent to {$count} users." . PHP_EOL;
```

Edit the title and message before running the script. This creates Studio notifications and does not send email.

For automatic alerts on failed scheduled executions, use the schedule's notification settings instead;
see [Failure notifications](../README.md#failure-notifications).

[Back to README](../README.md)

## History and reusable command templates

Use [persistent history and templates](history-and-templates.md) to inspect past executions, create
parameter forms for repeated tasks, and implement read-only previews of affected objects.

Use [workflows](workflows.md) to chain several commands into one background run that stops at the
first failure and keeps a history entry per step.
