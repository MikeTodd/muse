import 'reflect-metadata';
import {Collection} from 'discord.js';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  containerGet: vi.fn(),
}));

vi.mock('../src/inversify.config.js', () => ({
  default: {get: mocks.containerGet},
}));

import handleMessageReactionAdd from '../src/events/message-reaction-add.js';
import {STATUS} from '../src/services/player.js';

const makePlayer = (overrides: Record<string, unknown> = {}) => ({
  getCurrent: vi.fn(() => ({isLive: false, length: 100})),
  getPosition: vi.fn(() => 30),
  isPlayingMessage: vi.fn(() => true),
  pause: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  refreshPlayingMessage: vi.fn(),
  seek: vi.fn().mockResolvedValue(undefined),
  status: STATUS.PLAYING,
  stop: vi.fn(),
  voiceConnection: {joinConfig: {channelId: 'voice-id'}},
  ...overrides,
});

const makeReaction = (emoji: string, player: ReturnType<typeof makePlayer>, memberVoiceId = 'voice-id') => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const guild = {
    id: 'guild-id',
    members: {
      cache: new Collection([
        ['user-id', {voice: {channelId: memberVoiceId}}],
      ]),
    },
  };
  const reaction = {
    emoji: {name: emoji},
    message: {guild, id: 'playing-message-id', partial: false},
    partial: false,
    users: {remove},
  };
  mocks.containerGet.mockReturnValue({getExisting: vi.fn(() => player)});

  return {reaction, remove};
};

const user = {bot: false, id: 'user-id'};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playback-message reaction controls', () => {
  it('fast-forwards and rewinds by ten seconds', async () => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction('⏩', player).reaction as never, user as never);
    expect(player.seek).toHaveBeenLastCalledWith(40);

    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);
    expect(player.seek).toHaveBeenLastCalledWith(20);
  });

  it('clamps seeks at track boundaries and preserves a paused state', async () => {
    const player = makePlayer({
      getPosition: vi.fn(() => 5),
      pause: vi.fn(),
      status: STATUS.PAUSED,
    });
    player.seek.mockImplementation(async () => {
      player.status = STATUS.PLAYING;
    });

    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);

    expect(player.seek).toHaveBeenCalledWith(0);
    expect(player.pause).toHaveBeenCalledOnce();
  });

  it('toggles pause/resume and stops playback', async () => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction('⏯️', player).reaction as never, user as never);
    expect(player.pause).toHaveBeenCalledOnce();

    player.status = STATUS.PAUSED;
    await handleMessageReactionAdd(makeReaction('⏯', player).reaction as never, user as never);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.refreshPlayingMessage).toHaveBeenCalledOnce();

    await handleMessageReactionAdd(makeReaction('⏹️', player).reaction as never, user as never);
    expect(player.stop).toHaveBeenCalledOnce();
  });

  it('rejects reactions from outside the bot voice channel', async () => {
    const player = makePlayer();
    const {reaction, remove} = makeReaction('⏩', player, 'other-voice-id');

    await handleMessageReactionAdd(reaction as never, user as never);

    expect(remove).toHaveBeenCalledWith('user-id');
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('ignores controls on stale messages and livestream seeks', async () => {
    const stalePlayer = makePlayer({isPlayingMessage: vi.fn(() => false)});
    await handleMessageReactionAdd(makeReaction('⏩', stalePlayer).reaction as never, user as never);
    expect(stalePlayer.seek).not.toHaveBeenCalled();

    const livePlayer = makePlayer({getCurrent: vi.fn(() => ({isLive: true, length: 0}))});
    await handleMessageReactionAdd(makeReaction('⏩', livePlayer).reaction as never, user as never);
    expect(livePlayer.seek).not.toHaveBeenCalled();
  });
});
