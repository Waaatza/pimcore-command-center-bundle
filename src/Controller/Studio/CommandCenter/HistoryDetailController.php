<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use OpenApi\Attributes as OA;

/** @internal */
final class HistoryDetailController
{
    public function __construct(private readonly CommandHistoryStore $history)
    {
    }

    #[Route('/command-center/history/{id}', name: 'watza_command_center_historydetail', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: '/command-center/history/{id}', summary: 'command_center_historydetail', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_historydetail_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(string $id): JsonResponse
    {
        return new JsonResponse($this->history->get($id), headers: ['Cache-Control' => 'private, no-store']);
    }
}
