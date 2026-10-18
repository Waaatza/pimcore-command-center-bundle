<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Model\User;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

/** @internal */
final readonly class ScheduleRecipientService
{
    public function list(): array
    {
        $listing = new User\Listing();
        $listing->setCondition('active = ?', [1]);
        $listing->setOrderKey('name');

        return array_map(static fn (User $user): array => [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'studioAllowed' => $user->isAllowed('notifications'),
        ], array_values(array_filter($listing->load(), static fn ($user): bool => $user instanceof User)));
    }

    public function validate(array $ids, array $channels): void
    {
        if (count($ids) > 50 || array_diff($channels, ['email', 'studio']) !== []) {
            throw new BadRequestHttpException('Invalid notification recipients or channels.');
        }
        if (($ids === []) !== ($channels === [])) {
            throw new BadRequestHttpException('Select both recipients and notification channels, or leave both empty.');
        }
        foreach ($ids as $id) {
            $user = is_int($id) && $id > 0 ? User::getById($id) : null;
            if (!$user instanceof User || !$user->getActive()) {
                throw new BadRequestHttpException('Notification recipient must be an active Pimcore user.');
            }
            if (in_array('email', $channels, true) && !filter_var($user->getEmail(), FILTER_VALIDATE_EMAIL)) {
                throw new BadRequestHttpException('Every email recipient needs a valid email address.');
            }
            if (in_array('studio', $channels, true) && !$user->isAllowed('notifications')) {
                throw new BadRequestHttpException('Every Studio recipient needs the notifications permission.');
            }
        }
    }
}
