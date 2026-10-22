import { describe, expect, it } from 'vitest'
import { restoreBounds, type Rect } from '../../src/main/services/window-state'

const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const second: Rect = { x: 1920, y: 0, width: 1280, height: 984 }

describe('restoreBounds', () => {
  it('sin nada guardado: tamaño por defecto centrado en la principal', () => {
    expect(restoreBounds(null, [primary], primary)).toEqual({
      bounds: { x: 320, y: 110, width: 1280, height: 820 },
      maximized: false
    })
  })

  it('posición guardada visible: se respeta (también en la segunda pantalla)', () => {
    const saved = { x: 2000, y: 40, width: 1000, height: 700, maximized: true }
    expect(restoreBounds(saved, [primary, second], primary)).toEqual({
      bounds: { x: 2000, y: 40, width: 1000, height: 700 },
      maximized: true
    })
  })

  it('pantalla desconectada: centrada en la principal con el tamaño guardado', () => {
    const saved = { x: 2000, y: 40, width: 1000, height: 700, maximized: false }
    expect(restoreBounds(saved, [primary], primary).bounds).toEqual({
      x: 460,
      y: 170,
      width: 1000,
      height: 700
    })
  })

  it('casi fuera: si se ven menos de 100×50 px, se centra', () => {
    const saved = { x: 1880, y: 1000, width: 1000, height: 700, maximized: false }
    expect(restoreBounds(saved, [primary], primary).bounds.x).toBe(460)
  })

  it('más grande que la pantalla: se acota a su área; la barra de título queda dentro', () => {
    const saved = { x: -50, y: -30, width: 4000, height: 3000, maximized: false }
    expect(restoreBounds(saved, [primary], primary).bounds).toEqual({
      x: -50,
      y: 0,
      width: 1920,
      height: 1040
    })
  })

  it('más pequeña que el mínimo o con valores no numéricos', () => {
    expect(
      restoreBounds({ x: 10, y: 10, width: 200, height: 100 }, [primary], primary).bounds
    ).toEqual({ x: 10, y: 10, width: 900, height: 600 })
    expect(
      restoreBounds({ x: 'a', y: 0, width: 1, height: 1 }, [primary], primary).bounds.width
    ).toBe(1280)
    expect(restoreBounds({ x: NaN, y: 0, width: 1, height: 1 }, [primary], primary).maximized).toBe(
      false
    )
  })
})
