import db from "@/db/database";
import { inventoryItem } from "@/db/schema";
import { eq } from 'drizzle-orm';

type MeasurementUnit = 'mg' | 'ml';

interface InventoryItemData {
  id: number;
  name: string;
  quantity: number;
  quantityUnit: MeasurementUnit;
  createdAt?: string;
  updatedAt?: string;
}

export default class InventoryItem {
  id: number;
  name: string;
  quantity: number;
  quantityUnit: MeasurementUnit;
  createdAt?: string;
  updatedAt?: string;

  constructor(data: InventoryItemData) {
    this.id = data.id;
    this.name = data.name;
    this.quantity = data.quantity;
    this.quantityUnit = data.quantityUnit;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  // Find all inventory items
  static async findAll(): Promise<InventoryItem[]> {
    try {
      const inventoryRecords = await db
        .select()
        .from(inventoryItem)
        .all();
      
      return inventoryRecords.map(record => new InventoryItem({
        id: record.id,
        name: record.name,
        quantity: record.quantity,
        quantityUnit: record.quantityUnit,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    } catch (err) {
      console.error('Error finding all inventory items:', err);
      throw err;
    }
  }

  // Find inventory item by ID
  static async findById(id: number): Promise<InventoryItem | null> {
    try {
      const [inventoryRecord] = await db
        .select()
        .from(inventoryItem)
        .where(eq(inventoryItem.id, id))
        .limit(1);

      if (!inventoryRecord) {
        return null;
      }

      return new InventoryItem({
        id: inventoryRecord.id,
        name: inventoryRecord.name,
        quantity: inventoryRecord.quantity,
        quantityUnit: inventoryRecord.quantityUnit,
        createdAt: inventoryRecord.createdAt,
        updatedAt: inventoryRecord.updatedAt,
      });
    } catch (err) {
      console.error(`Error finding inventory item with ID ${id}:`, err);
      throw err;
    }
  }

  // Check if there's sufficient quantity available
  hasSufficientQuantity(requiredQuantity: number): boolean {
    return this.quantity >= requiredQuantity;
  }

  // Validate if sufficient stock is available for a required quantity
  validateSufficientStock(requiredQuantity: number): {
    isAvailable: boolean;
    availableQuantity: number;
    requiredQuantity: number;
    shortfall: number;
  } {
    const isAvailable = this.quantity >= requiredQuantity;
    const shortfall = isAvailable ? 0 : requiredQuantity - this.quantity;

    return {
      isAvailable,
      availableQuantity: this.quantity,
      requiredQuantity,
      shortfall,
    };
  }

  // Update inventory quantity with retry logic for SQLite BUSY
  static async updateQuantity(id: number, newQuantity: number): Promise<InventoryItem | null> {
    const maxRetries = 5;
    let attempt = 0;

    // Ensure quantity doesn't go negative
    if (newQuantity < 0) {
      throw new Error(`Cannot set negative quantity: ${newQuantity}`);
    }

    while (attempt < maxRetries) {
      try {
        const [updatedRecord] = await db
          .update(inventoryItem)
          .set({ 
            quantity: newQuantity,
            updatedAt: new Date().toISOString()
          })
          .where(eq(inventoryItem.id, id))
          .returning();

        if (!updatedRecord) {
          return null;
        }

        return new InventoryItem({
          id: updatedRecord.id,
          name: updatedRecord.name,
          quantity: updatedRecord.quantity,
          quantityUnit: updatedRecord.quantityUnit,
          createdAt: updatedRecord.createdAt,
          updatedAt: updatedRecord.updatedAt,
        });

      } catch (err: any) {
        attempt++;
        
        // Check if this is a SQLite BUSY error
        if ((err?.cause?.code === 'SQLITE_BUSY' || err?.code === 'SQLITE_BUSY') && attempt < maxRetries) {
          console.log(`SQLite busy, retrying attempt ${attempt}/${maxRetries} for inventory ID ${id}...`);
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
          continue;
        }
        
        console.error(`Error updating inventory quantity for ID ${id}:`, err);
        throw err;
      }
    }
    
    throw new Error(`Failed to update inventory after ${maxRetries} attempts due to database lock`);
  }

  // Deduct quantity from inventory
  static async deductQuantity(id: number, quantityToDeduct: number): Promise<InventoryItem | null> {
    try {
      // First, get current item to check availability
      const currentItem = await InventoryItem.findById(id);
      if (!currentItem) {
        throw new Error(`Inventory item with ID ${id} not found`);
      }

      // Validate sufficient stock
      const validation = currentItem.validateSufficientStock(quantityToDeduct);
      if (!validation.isAvailable) {
        throw new Error(
          `Insufficient stock for ${currentItem.name}. ` +
          `Required: ${quantityToDeduct}${currentItem.quantityUnit}, ` +
          `Available: ${validation.availableQuantity}${currentItem.quantityUnit}, ` +
          `Shortfall: ${validation.shortfall}${currentItem.quantityUnit}`
        );
      }

      // Calculate new quantity
      const newQuantity = currentItem.quantity - quantityToDeduct;

      // Update the quantity
      return await InventoryItem.updateQuantity(id, newQuantity);
    } catch (err) {
      console.error(`Error deducting quantity from inventory ID ${id}:`, err);
      throw err;
    }
  }

  // Add quantity to inventory for restocking
  static async addQuantity(id: number, quantityToAdd: number): Promise<InventoryItem | null> {
    try {
      if (quantityToAdd <= 0) {
        throw new Error(`Cannot add non-positive quantity: ${quantityToAdd}`);
      }

      // Get current item
      const currentItem = await InventoryItem.findById(id);
      if (!currentItem) {
        throw new Error(`Inventory item with ID ${id} not found`);
      }

      // Calculate new quantity
      const newQuantity = currentItem.quantity + quantityToAdd;

      // Update the quantity
      return await InventoryItem.updateQuantity(id, newQuantity);
    } catch (err) {
      console.error(`Error adding quantity to inventory ID ${id}:`, err);
      throw err;
    }
  }

  // Get current available quantity
  getAvailableQuantity(): number {
    return this.quantity;
  }

  // Get formatted quantity string
  getFormattedQuantity(): string {
    return `${this.quantity}${this.quantityUnit}`;
  }

  // Check if item is out of stock
  isOutOfStock(): boolean {
    return this.quantity <= 0;
  }

  // Check if item is low stock based on threshold
  isLowStock(threshold: number): boolean {
    return this.quantity > 0 && this.quantity <= threshold;
  }
} 