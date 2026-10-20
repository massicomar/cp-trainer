import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'selection.count': { paramsTuple?: []; params?: {} }
    'lessons.store': { paramsTuple?: []; params?: {} }
    'lessons.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.answer': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.give_up': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.skip': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.continue': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.summary': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.report': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'contribute.show': { paramsTuple?: []; params?: {} }
    'contribute.preview': { paramsTuple?: []; params?: {} }
    'preferences.update': { paramsTuple?: []; params?: {} }
    'health': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'selection.count': { paramsTuple?: []; params?: {} }
    'lessons.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.summary': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.report': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'contribute.show': { paramsTuple?: []; params?: {} }
    'health': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'selection.count': { paramsTuple?: []; params?: {} }
    'lessons.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.summary': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.report': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'contribute.show': { paramsTuple?: []; params?: {} }
    'health': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'lessons.store': { paramsTuple?: []; params?: {} }
    'lessons.answer': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.give_up': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.skip': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.continue': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lessons.next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'contribute.preview': { paramsTuple?: []; params?: {} }
    'preferences.update': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}