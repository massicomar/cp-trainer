import DrillItem from '#models/drill_item'
import type { AlgorithmData, BigOTableData } from '#types/drills'

export const BIG_O_ID = 'general:big-o'

/**
 * Read access to the synced drill content.
 */
export default class DrillCatalog {
  /** The Big O table; null when the content has none. */
  async table(): Promise<BigOTableData | null> {
    const item = await DrillItem.query().where('id', BIG_O_ID).where('deprecated', false).first()
    return item ? (item.data as BigOTableData) : null
  }

  /**
   * An algorithm by drill item id. Deprecated ones still load, so a lesson
   * that already includes one can finish.
   */
  async algorithm(id: string): Promise<{ id: string; data: AlgorithmData } | null> {
    const item = await DrillItem.query().where('id', id).where('kind', 'algorithm').first()
    return item ? { id: item.id, data: item.data as AlgorithmData } : null
  }

  /** Ids of the current algorithms of these subjects. */
  async algorithmIds(subjects: string[]): Promise<string[]> {
    if (!subjects.length) return []
    const items = await DrillItem.query()
      .where('kind', 'algorithm')
      .where('deprecated', false)
      .whereIn('subject_id', subjects)
      .select('id')
      .orderBy('id')
    return items.map((item) => item.id)
  }
}
