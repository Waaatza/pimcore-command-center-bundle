<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\StudioActionRequest;
use Watza\CommandCenterBundle\Service\StudioActionService;

/** @internal */
final class StudioActionRunController
{
    public function __construct(private readonly StudioActionService $service)
    {
    }

    #[Route(
        '/command-center/actions/run',
        name: 'watza_command_center_studioactionrun',
        methods: ['POST'],
    )]
    #[IsGranted('ROLE_PIMCORE_USER')]
    #[OA\Post(
        path: '/command-center/actions/run', summary: 'command_center_studioactionrun', tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_studioactionrun_success')]
    #[OA\Response(response: 403, description: 'Access denied')]
    public function __invoke(#[MapRequestPayload] StudioActionRequest $parameters): JsonResponse|StreamedResponse
    {
        $result = $this->service->run($parameters);

        return $result instanceof StreamedResponse ? $result : new JsonResponse($result);
    }
}
