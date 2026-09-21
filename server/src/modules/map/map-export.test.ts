import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_MAP_EXPORT_API,
  MAP_CHUNK_MARKER,
  MAP_CHUNK_SIZE,
  MAP_EXPORT_DONE_MARKER,
  MAP_MARK_MARKER,
  MAP_NAME_MARKER,
  buildMapExportScript,
  buildMapExportTriggerCommand,
  describeExportFailure,
  parseMapExportFailureLine,
  parseMapExportHeadLine,
  parseMarkLines,
  parseTileNameLine,
} from './map-export'

/**
 * 导出协议的测试。
 *
 * 这套协议是在真机上一步步逼出来的（见 `map-export.ts` 顶部的实测表），因此这里的断言
 * 大多对应一条**真机结论**，而不是风格偏好：不用 `io.open`、不用 `SetPersistentString`、
 * 只走 `io.write` 分块。谁改坏了这些，测试会直接说出后果。
 */

const script = (extra: Parameters<typeof buildMapExportScript>[0] extends infer T ? Partial<T> : never = {}) =>
  buildMapExportScript({ shard: 'master', ...extra })

describe('脚本：只用真机确认可用的通道', () => {
  it('用 print 输出：io.write 在这台专用服上不产出日志', () => {
    const content = script()
    assert.match(content, /print\(/)
    // 真机日志验证：io.write 是函数、调用也不报错，但输出不会进控制台日志
    assert.equal(content.includes('io.write'), false, 'io.write 的输出收不到，必须用 print')
    // 这几条在真机上全部不可用，出现在脚本里就是回归
    assert.equal(content.includes('io.open'), false, 'io.open 在真机上被沙箱拒绝')
    assert.equal(content.includes('SetPersistentString'), false, 'SetPersistentString 是空操作')
    assert.equal(content.includes('os.rename'), false)
    assert.equal(content.includes('os.execute'), false)
  })

  it('用真机确认过的方法名取尺寸与瓦片', () => {
    const content = script()
    assert.match(content, new RegExp(`Map:${DEFAULT_MAP_EXPORT_API.getSize}\\(\\)`))
    assert.match(content, new RegExp(`Map:${DEFAULT_MAP_EXPORT_API.getTile}\\(x,z\\)`))
  })

  it('方法名可换（换游戏版本时只改数据）', () => {
    const content = buildMapExportScript({
      shard: 'master',
      api: { getTile: 'GetTileAt', getSize: 'GetMapSize' },
    })
    assert.match(content, /Map:GetTileAt\(x,z\)/)
    assert.match(content, /Map:GetMapSize\(\)/)
    assert.equal(content.includes('Map:GetTile('), false)
  })

  it('编码格式是 <4 位次数><4 位地块>，与解码侧一致', () => {
    // 地块字段必须是 4 位：257（猴岛沙滩）、264（浮冰）都会在真实世界里出现，
    // `%02x` 会把它们静默截断成 1（不可通行）与 8（沼泽）
    assert.match(script(), /string\.format\("%04x%04x",run,cur%65536\)/)
    assert.equal(script().includes('cur%256'), false)
  })

  it('地标段在白名单里只放 prefab 名，并独立于地形成败', () => {
    const content = script()
    assert.match(content, /for _,e in pairs\(Ents\) do/)
    assert.match(content, /local okm=pcall\(/)
    // 白名单来自地标目录，改目录就该改脚本
    for (const prefab of ['pigking', 'cave_entrance', 'resurrectionstone']) {
      assert.equal(content.includes(`${prefab}=1`), true, `白名单缺少 ${prefab}`)
    }
    // 实体表读不到只是没有地标，绝不能让整次导出失败
    assert.match(content, new RegExp(`${MAP_MARK_MARKER}head:no-ents:0`))
    assert.equal(content.includes(`${MAP_EXPORT_DONE_MARKER}no-ents`), false)
  })

  it('地标段输出：头行 + 按序号分块，且能被解码侧解析', () => {
    const content = script()
    assert.match(content, new RegExp(`${MAP_MARK_MARKER}head:ok:`))
    // 用字面量而不是正则：Lua 的拼接符 `..` 与正则里的转义点很容易写混，
    // 这条断言要表达的只是"这段拼接确实存在"
    assert.equal(content.includes('hits[#hits+1]=p.."@"..math.floor(x+0.5)..","..math.floor(z+0.5)'), true)
    assert.equal(content.includes('table.concat(hits,";")'), true)
  })

  it('地块名段：把用到的每个地块都配上游戏自己的名字', () => {
    const content = script()
    // 编码时顺手记下用到过的地块；只在 cur 上记一次是不够的，每段开头的新地块也要记
    assert.equal(content.includes('local used={}'), true)
    assert.equal(content.includes('used[t]=1'), true)
    assert.equal(content.includes('used[cur]=1'), true)
    // 名字来自游戏自己的 GROUND_NAMES——面板不认识的号靠它才有名字
    assert.equal(content.includes('GROUND_NAMES'), true)
    assert.match(content, new RegExp(`${MAP_NAME_MARKER}"\\.\\.table\\.concat\\(names,","\\)`))
  })
})

describe('脚本：结构与失败路径', () => {
  it('是单条语句（不含裸换行，能被 loadstring 执行）', () => {
    assert.equal(script().includes('\n'), false)
  })

  it('每个失败路径都输出标记、不抛异常', () => {
    const content = script()
    for (const code of ['no-map', 'bad-size', 'tile-error']) {
      assert.match(content, new RegExp(`${MAP_EXPORT_DONE_MARKER}${code}`), `缺少 ${code} 分支`)
    }
    assert.match(content, /too-many-parts:/)
  })

  it('分块数超上限时中止，不刷屏', () => {
    const content = buildMapExportScript({ shard: 'master', maxChunks: 7 })
    assert.match(content, /total>7/)
    assert.match(content, /too-many-parts:/)
  })

  it('头行带分片、尺寸、种子与总块数', () => {
    const content = buildMapExportScript({ shard: 'caves' })
    assert.match(content, /head:caves:/)
    assert.match(content, /TheWorld\.meta and TheWorld\.meta\.seed/)
    assert.match(content, /\.\.total\.\./)
  })

  it('按块序号输出，且每块带上序号与总数', () => {
    const content = script()
    // 形如 io.write("GSHMAPPART:"..i.."/"..total..":"..string.sub(...))。
    // 这里用 includes 而不是正则：连写的 Lua 拼接符 `..` 与正则里的转义点很容易写混，
    // 而这条断言要表达的只是"三个片段都在"。
    assert.equal(content.includes(MAP_CHUNK_MARKER), true)
    assert.equal(content.includes('..i.."/"..total..'), true, '缺少序号/总数拼接')
    assert.match(content, /string\.sub\(payload,i\*\d+\+1,\(i\+1\)\*\d+\)/)
    assert.match(content, /for i=0,total-1 do/)
  })

  it('分块大小非法时直接抛错（编程错误，不该带进游戏）', () => {
    assert.throws(() => buildMapExportScript({ shard: 'master', chunkSize: 0 }), /必须为正数/)
  })
})

describe('触发命令', () => {
  it('是单条语句，且末尾带结束标记', () => {
    const command = buildMapExportTriggerCommand(script(), 'abcd1234')
    assert.match(command, /^loadstring\("/)
    assert.match(command, new RegExp(`${MAP_EXPORT_DONE_MARKER}abcd1234:end`))
  })

  it('长度在控制台上限（4096）以内——去掉写文件后更短了', () => {
    const command = buildMapExportTriggerCommand(script(), 'abcd1234')
    assert.equal(command.length < 4096, true, `命令长度 ${command.length} 超限`)
    // 地形段 + 地标段 + 白名单都在这一条语句里，留出余量而不是贴着 4096
    assert.equal(command.length < 3000, true, `命令偏长，实际 ${command.length}`)
  })

  it('不含裸换行，脚本里的换行被转义', () => {
    const command = buildMapExportTriggerCommand('a\nb', 'tok')
    assert.equal(command.includes('\n'), false)
    assert.match(command, /a\\nb/)
  })
})

describe('头行解析', () => {
  it('解析尺寸、分片、种子与总块数', () => {
    const parsed = parseMapExportHeadLine('GSHMAPDONE:head:master:425x425:1608382646:180')
    assert.deepEqual(parsed, {
      kind: 'ok',
      width: 425,
      height: 425,
      seed: '1608382646',
      totalParts: 180,
    })
  })

  it('种子是 -1（游戏没记录）时给 null', () => {
    const parsed = parseMapExportHeadLine('GSHMAPDONE:head:master:425x425:-1:3')
    assert.equal(parsed?.kind === 'ok' ? parsed.seed : 'x', null)
  })

  it('尺寸非法时报失败', () => {
    const parsed = parseMapExportHeadLine('GSHMAPDONE:head:master:0x425:1:3')
    assert.equal(parsed?.kind, 'failed')
  })

  it('不是头行时返回 null', () => {
    assert.equal(parseMapExportHeadLine('GSHMAPPART:tok:0/1:aabb'), null)
    assert.equal(parseMapExportHeadLine('普通日志'), null)
  })
})

describe('失败行解析', () => {
  it('识别失败码', () => {
    assert.equal(parseMapExportFailureLine('GSHMAPDONE:no-map'), 'no-map')
    assert.equal(parseMapExportFailureLine('GSHMAPDONE:too-many-parts:900'), 'too-many-parts:900')
  })

  it('head 与 end 不算失败', () => {
    assert.equal(parseMapExportFailureLine('GSHMAPDONE:end'), null)
    assert.equal(parseMapExportFailureLine('GSHMAPDONE:head:master:425x425:1:2'), null)
  })

  it('无关行返回 null', () => {
    assert.equal(parseMapExportFailureLine('GSHMAPPART:tok:0/1:aabb'), null)
  })
})

describe('失败文案', () => {
  it('已知码都有面向用户的说法', () => {
    assert.match(describeExportFailure('no-map'), /还没有可读取的世界地图/)
    assert.match(describeExportFailure('bad-size'), /尺寸不合法/)
    assert.match(describeExportFailure('tile-error'), /读取地块数据时出错/)
    assert.match(describeExportFailure('too-many-parts:900'), /分块过多/)
    assert.match(describeExportFailure('weird'), /weird/)
    assert.equal(describeExportFailure(''), '地形导出失败')
  })
})

describe('分块参数', () => {
  it('块大小在日志行可接受范围内', () => {
    assert.equal(MAP_CHUNK_SIZE > 0 && MAP_CHUNK_SIZE < 4096, true)
  })
})

describe('地标行解析', () => {
  const head = (status: string, total: number) => `${MAP_MARK_MARKER}head:${status}:${total}`
  const part = (index: number, total: number, body: string) => `${MAP_MARK_MARKER}${index}/${total}:${body}`

  it('解析 prefab 与世界坐标', () => {
    const parsed = parseMarkLines([
      head('ok', 1),
      part(0, 1, 'pigking@-120,340;cave_entrance@55,-8'),
    ], 'tok')
    assert.equal(parsed.status, 'ok')
    assert.equal(parsed.complete, true)
    assert.deepEqual(parsed.points, [
      { prefab: 'pigking', x: -120, z: 340 },
      { prefab: 'cave_entrance', x: 55, z: -8 },
    ])
  })

  it('按序号跨块拼接', () => {
    const parsed = parseMarkLines([
      head('ok', 2),
      part(1, 2, 'cave_entrance@1,2'),
      part(0, 2, 'pigking@3,4;'),
    ], 'tok')
    assert.deepEqual(parsed.points.map(point => point.prefab), ['pigking', 'cave_entrance'])
  })

  it('缺块时如实报缺，调用方不会拼出一份错位的标记', () => {
    const parsed = parseMarkLines([head('ok', 3), part(0, 3, 'pigking@1,1;')], 'tok')
    assert.equal(parsed.complete, false)
    assert.deepEqual(parsed.missing, [1, 2])
  })

  it('没收到标记段时是 absent，而不是"读到 0 个地标"', () => {
    const parsed = parseMarkLines(['GSHMAPPART:tok:0/1:aabb'], 'tok')
    assert.equal(parsed.status, 'absent')
    assert.deepEqual(parsed.points, [])
    assert.equal(parsed.complete, true)
  })

  it('实体表不可用时是 no-ents，且没有待收的分块', () => {
    const parsed = parseMarkLines([head('no-ents', 0)], 'tok')
    assert.equal(parsed.status, 'no-ents')
    assert.equal(parsed.complete, true)
    assert.deepEqual(parsed.points, [])
  })

  it('单点格式坏掉时只丢那一个点，不整层失败', () => {
    const parsed = parseMarkLines([
      head('ok', 1),
      part(0, 1, 'pigking@1,1;坏点;cave_entrance@2,2'),
    ], 'tok')
    assert.deepEqual(parsed.points.map(point => point.prefab), ['pigking', 'cave_entrance'])
  })

  it('脚本源码的回显行不会被当成数据', () => {
    // 回显里含引号与 `..`，与真实数据行的字符集不同；解析必须靠这一点把它们区分开
    const echo = 'print("GSHMAPMARK:"..i.."/"..mtotal..":"..string.sub(mpay,i*1200+1,(i+1)*1200))'
    const parsed = parseMarkLines([head('ok', 1), echo, part(0, 1, 'pigking@1,1')], 'tok')
    assert.equal(parsed.complete, true)
    assert.deepEqual(parsed.points.map(point => point.prefab), ['pigking'])
  })

  it('日志前缀不影响解析（日志系统会加时间戳）', () => {
    const parsed = parseMarkLines([
      `[00:01:23]: ${head('ok', 1)}`,
      `[00:01:23]: ${part(0, 1, 'pigking@7,8')}`,
    ], 'tok')
    assert.deepEqual(parsed.points, [{ prefab: 'pigking', x: 7, z: 8 }])
  })

  it('空标记段是合法的：世界本来就没有这些地标', () => {
    const parsed = parseMarkLines([head('ok', 0)], 'tok')
    assert.equal(parsed.status, 'ok')
    assert.equal(parsed.complete, true)
    assert.deepEqual(parsed.points, [])
  })
})

describe('地块名行解析', () => {
  it('真机上那三个没收录的地块，名字都能取到', () => {
    const names = parseTileNameLine([
      'GSHMAPNAME:203=Swell Ocean,263=Ice Floe,269=Moon Crater,272=Rocky Beach',
    ])
    assert.equal(names.get(263), 'Ice Floe')
    assert.equal(names.get(269), 'Moon Crater')
    assert.equal(names.get(272), 'Rocky Beach')
    assert.equal(names.size, 4)
  })

  it('名字里有空格也能完整取到（英文官方名基本都带空格）', () => {
    const names = parseTileNameLine(['GSHMAPNAME:35=Gorge Peat Forest'])
    assert.equal(names.get(35), 'Gorge Peat Forest')
  })

  it('日志前缀不影响解析', () => {
    const names = parseTileNameLine(['[00:01:23]: GSHMAPNAME:6=Grass'])
    assert.equal(names.get(6), 'Grass')
  })

  it('**脚本源码的回显行不会被当成数据**（回显里含引号）', () => {
    const echo = 'print("GSHMAPNAME:"..table.concat(names,","))'
    assert.equal(parseTileNameLine([echo]).size, 0)
  })

  it('游戏给不出名字时那一项被跳过，而不是记成空名字', () => {
    const names = parseTileNameLine(['GSHMAPNAME:263=,269=Moon Crater'])
    assert.equal(names.has(263), false)
    assert.equal(names.get(269), 'Moon Crater')
  })

  it('格式坏掉的项被跳过，不影响同一行里的其它项', () => {
    const names = parseTileNameLine(['GSHMAPNAME:坏项,263=Ice Floe,=x,70000=Too Big'])
    assert.deepEqual([...names.keys()], [263])
  })

  it('没有任何名字行时得到空表（老脚本、日志被刷掉都走这条路）', () => {
    assert.equal(parseTileNameLine(['GSHMAPPART:tok:0/1:aabb']).size, 0)
    assert.equal(parseTileNameLine([]).size, 0)
  })
})
