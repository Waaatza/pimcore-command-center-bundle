<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\StudioActionRequest;
use Watza\CommandCenterBundle\Service\StudioActionService;

/** @internal */
final class StudioActionPrepareController
{
    public function __construct(private readonly StudioActionService $service)
    {
    }

    #[Route(
        '/command-center/actions/prepare',
        name: 'watza_command_center_studioactionprepare',
        methods: ['POST'],
    )]
    #[IsGranted('ROLE_PIMCORE_USER')]
    #[OA\Post(
        path: '/command-center/actions/prepare', summary: 'command_center_studioactionprepare', tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_studioactionprepare_success')]
    #[OA\Response(response: 403, description: 'Access denied')]
    public function __invoke(#[MapRequestPayload] StudioActionRequest $parameters): JsonResponse
    {
        return new JsonResponse($this->service->prepare($parameters), headers: ['Cache-Control' => 'no-store']);
    }
}
