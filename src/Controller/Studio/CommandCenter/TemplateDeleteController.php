<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Service\CommandTemplateService;

/** @internal */
final class TemplateDeleteController
{
    public function __construct(private readonly CommandTemplateService $service)
    {
    }

    #[Route('/command-center/templates/delete', name: 'watza_command_center_templatedelete', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/templates/delete', summary: 'command_center_templatedelete', tags: ['Command Center'])]
    #[OA\Response(response: 204, description: 'command_center_templatedelete_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] TemplateActionParameters $parameters): JsonResponse
    {
        $this->service->delete($parameters);
        return new JsonResponse(null, 204);
    }
}
