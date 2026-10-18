<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\CommandCenterService;

/** @internal */
final class ListController
{
    public function __construct(private readonly CommandCenterService $service)
    {
    }

    #[Route('/command-center/list', name: 'watza_command_center_list', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: '/command-center/list', summary: 'command_center_list', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_list_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse($this->service->catalog());
    }
}
