import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ROOM_SETTINGS_LABEL,
  splitRoomSettingsLinks,
  WHITELIST_DISABLED_WARNING,
} from './playerListWarning'

describe('splitRoomSettingsLinks', () => {
  it('turns the room-settings mention into a link segment', () => {
    assert.deepEqual(
      splitRoomSettingsLinks(`白名单当前未启用：请到「房间管理 → ${ROOM_SETTINGS_LABEL}」把预留位填成大于 0 的数字并保存。`),
      [
        { text: '白名单当前未启用：请到「房间管理 → ', link: false },
        { text: '房间设置', link: true },
        { text: '」把预留位填成大于 0 的数字并保存。', link: false },
      ],
    )
  })

  it('keeps a warning without the term as one plain segment', () => {
    assert.deepEqual(splitRoomSettingsLinks('名单内的玩家无法加入房间。'), [
      { text: '名单内的玩家无法加入房间。', link: false },
    ])
  })

  it('handles the term at the very start or the very end', () => {
    assert.deepEqual(splitRoomSettingsLinks(ROOM_SETTINGS_LABEL), [
      { text: '房间设置', link: true },
    ])
    assert.deepEqual(splitRoomSettingsLinks('请到房间设置'), [
      { text: '请到', link: false },
      { text: '房间设置', link: true },
    ])
  })

  it('links every occurrence when the term shows up twice', () => {
    assert.deepEqual(splitRoomSettingsLinks('房间设置里的预留位；房间设置保存后生效'), [
      { text: '房间设置', link: true },
      { text: '里的预留位；', link: false },
      { text: '房间设置', link: true },
      { text: '保存后生效', link: false },
    ])
  })

  it('returns nothing for empty text', () => {
    assert.deepEqual(splitRoomSettingsLinks(''), [])
  })
})

describe('WHITELIST_DISABLED_WARNING', () => {
  it('carries exactly one room-settings entry point', () => {
    const links = splitRoomSettingsLinks(WHITELIST_DISABLED_WARNING).filter(segment => segment.link)
    assert.equal(links.length, 1)
  })

  it('rebuilds the original sentence when the segments are joined back', () => {
    const joined = splitRoomSettingsLinks(WHITELIST_DISABLED_WARNING)
      .map(segment => segment.text)
      .join('')
    assert.equal(joined, WHITELIST_DISABLED_WARNING)
  })
})
