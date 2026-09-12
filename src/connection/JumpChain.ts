import { isSftpConnectionType, type RemoteConnectionType } from '../remote/RemoteConnectionTypes';

export interface JumpProfileDescriptor {
  readonly id: string;
  readonly name: string;
  readonly connectionType: RemoteConnectionType;
  readonly jumpProfileId?: string;
  readonly host?: string;
  readonly port?: number;
}

export type JumpChainValidationErrorCode =
  | 'self-reference'
  | 'cycle'
  | 'missing-profile'
  | 'unsupported-protocol';

interface JumpChainValidationErrorOptions {
  profileId?: string;
  referencedProfileId?: string;
  pathProfileIds: string[];
}

export class JumpChainValidationError extends Error {
  readonly code: JumpChainValidationErrorCode;
  readonly profileId?: string;
  readonly referencedProfileId?: string;
  readonly pathProfileIds: readonly string[];

  constructor(code: JumpChainValidationErrorCode, message: string, options: JumpChainValidationErrorOptions) {
    super(message);
    this.name = 'JumpChainValidationError';
    this.code = code;
    this.profileId = options.profileId;
    this.referencedProfileId = options.referencedProfileId;
    this.pathProfileIds = [...options.pathProfileIds];
  }
}

/**
 * Resolves references in connection order: the first item is the outermost jump
 * reachable from the local machine and the last item is closest to the target.
 * For `A -> B -> C`, resolving A returns `[C, B]`.
 */
export function resolveJumpProfileChain<T extends JumpProfileDescriptor>(
  target: JumpProfileDescriptor,
  profiles: readonly T[]
): T[] {
  const targetId = normalizeProfileId(target.id);
  let referencedProfileId = normalizeProfileId(target.jumpProfileId);

  if (!referencedProfileId) {
    return [];
  }

  const profilesById = new Map<string, T>();
  for (const profile of profiles) {
    const profileId = normalizeProfileId(profile.id);
    if (profileId && !profilesById.has(profileId)) {
      profilesById.set(profileId, profile);
    }
  }

  if (targetId && referencedProfileId === targetId) {
    throw createSelfReferenceError(target, [targetId, targetId]);
  }

  const visitedProfileIds = new Set<string>();
  if (targetId) {
    visitedProfileIds.add(targetId);
  }

  const pathProfileIds = targetId ? [targetId] : [];
  const nearestToOutermost: T[] = [];

  while (referencedProfileId) {
    if (visitedProfileIds.has(referencedProfileId)) {
      const cyclePath = [...pathProfileIds, referencedProfileId];
      throw new JumpChainValidationError(
        'cycle',
        `Jump chain contains a cycle: ${formatProfilePath(cyclePath, profilesById, target)}.`,
        {
          profileId: referencedProfileId,
          referencedProfileId,
          pathProfileIds: cyclePath
        }
      );
    }

    const profile = profilesById.get(referencedProfileId);
    if (!profile) {
      const missingPath = [...pathProfileIds, referencedProfileId];
      throw new JumpChainValidationError(
        'missing-profile',
        `Jump profile '${referencedProfileId}' was not found in chain ${formatProfilePath(missingPath, profilesById, target)}.`,
        {
          referencedProfileId,
          pathProfileIds: missingPath
        }
      );
    }

    if (!isSftpConnectionType(profile.connectionType)) {
      const unsupportedPath = [...pathProfileIds, referencedProfileId];
      throw new JumpChainValidationError(
        'unsupported-protocol',
        `Jump profile '${formatProfileName(profile)}' must use SFTP, but it uses ${String(profile.connectionType || '').toUpperCase()}.`,
        {
          profileId: referencedProfileId,
          referencedProfileId,
          pathProfileIds: unsupportedPath
        }
      );
    }

    visitedProfileIds.add(referencedProfileId);
    pathProfileIds.push(referencedProfileId);
    nearestToOutermost.push(profile);

    const nextProfileId = normalizeProfileId(profile.jumpProfileId);
    if (nextProfileId && nextProfileId === referencedProfileId) {
      throw createSelfReferenceError(profile, [...pathProfileIds, nextProfileId]);
    }

    referencedProfileId = nextProfileId;
  }

  return nearestToOutermost.reverse();
}

function createSelfReferenceError(profile: JumpProfileDescriptor, pathProfileIds: string[]): JumpChainValidationError {
  const profileId = normalizeProfileId(profile.id);
  return new JumpChainValidationError(
    'self-reference',
    `Connection '${formatProfileName(profile)}' cannot use itself as a jump.`,
    {
      profileId,
      referencedProfileId: profileId,
      pathProfileIds
    }
  );
}

function formatProfilePath<T extends JumpProfileDescriptor>(
  profileIds: readonly string[],
  profilesById: ReadonlyMap<string, T>,
  target: JumpProfileDescriptor
): string {
  const targetId = normalizeProfileId(target.id);
  return profileIds
    .map(profileId => {
      if (targetId && profileId === targetId) {
        return formatProfileName(target);
      }
      const profile = profilesById.get(profileId);
      return profile ? formatProfileName(profile) : profileId;
    })
    .join(' -> ');
}

function formatProfileName(profile: JumpProfileDescriptor): string {
  const name = String(profile.name || '').trim();
  return name || normalizeProfileId(profile.id) || 'unnamed connection';
}

function normalizeProfileId(value: unknown): string {
  return String(value || '').trim();
}
