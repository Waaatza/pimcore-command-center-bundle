# Failure notifications

Choose active Pimcore users and **E-Mail**, **Studio-Benachrichtigung**, or both when creating a schedule. For
an existing schedule, open **Details** and save its notification settings; changes apply to subsequent runs,
and leaving recipients and channels empty disables alerts.

Failed runs (nonzero exit codes, exceptions and timeouts) and worker-interrupted runs trigger alerts;
successful runs do not. Each alert lists the plan, command, status and timestamps, but not the PHP source,
arguments or output; inspect the full output in the Command Center.

Email uses Pimcore's existing mail configuration, including its sender address and transport, and recipients
need a valid email address. Studio recipients need the `notifications` permission. Users are checked again at
send time, so deleted/inactive users and revoked permissions are handled as delivery failures.

Delivery results appear with the latest run's details; a failed delivery does not rerun the command or block
other recipients/channels. Deliveries are attempted once with no automatic retry, so a worker crash during
delivery may leave an alert unsent — command execution is never replayed to send an alert.
