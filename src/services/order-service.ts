// import db from '@/db/database';
import { InventoryService, OrderAvailabilityResult } from './inventory-service';
import InventoryItem from '@/models/inventory-item';
import MenuItem from '@/models/menu-item';
import { logError, getSimpleErrorMessage } from './error-handler';
import db from '../db/database';

export interface OrderResult {
  success: boolean;
  menuItemName: string;
  message: string;
  orderDetails?: {
    menuItemId: number;
    ingredientsUsed: Array<{
      inventoryItemId: number;
      ingredientName: string;
      quantityUsed: number;
      quantityUnit: string;
      remainingQuantity: number;
    }>;
  };
  availabilityCheck?: OrderAvailabilityResult;
  error?: any;
}

export interface BatchOrderResult {
  overallSuccess: boolean;
  successfulOrders: OrderResult[];
  failedOrders: OrderResult[];
  totalOrdersProcessed: number;
  errors: any[];
}

export class OrderService {
  // Process a single order with inventory deduction
  static async processOrder(menuItemId: number): Promise<OrderResult> {
    // First, check if the order can be fulfilled
    const availabilityCheck = await InventoryService.checkOrderAvailability(menuItemId);
    
    if (!availabilityCheck.canFulfillOrder) {
      return {
        success: false,
        menuItemName: availabilityCheck.menuItemName,
        message: availabilityCheck.errorMessage || 'Order cannot be fulfilled',
        availabilityCheck
      };
    }

    try {
      // Process ingredients sequentially

      const menuItem = await MenuItem.findById(menuItemId);
      if (!menuItem) {
        throw new Error(`Menu item with ID ${menuItemId} not found`);
      }

      const ingredientsUsed: OrderResult['orderDetails']['ingredientsUsed'] = [];

      // Deduct each ingredient sequentially
      for (const ingredient of menuItem.ingredients) {
        const currentInventory = await InventoryItem.findById(ingredient.inventoryItemId);
        if (!currentInventory) {
          throw new Error(`Inventory item ${ingredient.ingredientName} not found`);
        }

        const validation = currentInventory.validateSufficientStock(ingredient.quantity);
        if (!validation.isAvailable) {
          throw new Error(
            `Insufficient stock for ${ingredient.ingredientName}. ` +
            `Required: ${ingredient.quantity}${ingredient.quantityUnit}, ` +
            `Available: ${validation.availableQuantity}${ingredient.quantityUnit}`
          );
        }

        const updatedInventory = await InventoryItem.deductQuantity(
          ingredient.inventoryItemId,
          ingredient.quantity
        );

        if (!updatedInventory) {
          throw new Error(`Failed to update inventory for ${ingredient.ingredientName}`);
        }

        ingredientsUsed.push({
          inventoryItemId: ingredient.inventoryItemId,
          ingredientName: ingredient.ingredientName,
          quantityUsed: ingredient.quantity,
          quantityUnit: ingredient.quantityUnit,
          remainingQuantity: updatedInventory.quantity
        });
      }

      return {
        success: true,
        menuItemName: menuItem.name,
        message: `${menuItem.name} order processed.`,
        orderDetails: {
          menuItemId: menuItem.id,
          ingredientsUsed
        },
        availabilityCheck
      };
    } catch (error) {
      logError('Order processing failed', error);
      return {
        success: false,
        menuItemName: availabilityCheck.menuItemName,
        message: getSimpleErrorMessage(error),
        availabilityCheck,
        error
      };
    }
  }

  // Process multiple orders in sequence
  static async processBatchOrders(menuItemIds: number[]): Promise<BatchOrderResult> {
    const successfulOrders: OrderResult[] = [];
    const failedOrders: OrderResult[] = [];
    const errors: any[] = [];

    for (const menuItemId of menuItemIds) {
      const result = await this.processOrder(menuItemId);
      
      if (result.success) {
        successfulOrders.push(result);
      } else {
        failedOrders.push(result);
        if (result.error) {
          errors.push(result.error);
        }
      }
    }

    return {
      overallSuccess: failedOrders.length === 0,
      successfulOrders,
      failedOrders,
      totalOrdersProcessed: menuItemIds.length,
      errors
    };
  }

  // Simulate processing an order without actually deducting inventory
  static async simulateOrder(menuItemId: number): Promise<{
    canProcess: boolean;
    menuItemName: string;
    message: string;
    wouldUseIngredients: Array<{
      ingredientName: string;
      quantityToUse: number;
      quantityUnit: string;
      currentQuantity: number;
      remainingAfterUse: number;
    }>;
  }> {
    const availabilityCheck = await InventoryService.checkOrderAvailability(menuItemId);
    
    if (!availabilityCheck.canFulfillOrder) {
      return {
        canProcess: false,
        menuItemName: availabilityCheck.menuItemName,
        message: availabilityCheck.errorMessage || 'Order cannot be processed',
        wouldUseIngredients: []
      };
    }

    const menuItem = await MenuItem.findById(menuItemId);
    if (!menuItem) {
      return {
        canProcess: false,
        menuItemName: 'Unknown Item',
        message: 'Menu item not found',
        wouldUseIngredients: []
      };
    }

    const wouldUseIngredients = availabilityCheck.ingredientChecks.map(check => ({
      ingredientName: check.ingredientName,
      quantityToUse: check.requiredQuantity,
      quantityUnit: check.quantityUnit,
      currentQuantity: check.availableQuantity,
      remainingAfterUse: check.availableQuantity - check.requiredQuantity
    }));

    return {
      canProcess: true,
      menuItemName: menuItem.name,
      message: `${menuItem.name} can be processed`,
      wouldUseIngredients
    };
  }

  // Get order capacity for all menu items
  static async getOrderCapacity(): Promise<{
    menuItems: Array<{
      menuItemId: number;
      menuItemName: string;
      maxOrdersPossible: number;
      limitingIngredient?: string;
      limitingIngredientDetails?: {
        ingredientName: string;
        availableQuantity: number;
        requiredPerServing: number;
        unit: string;
      };
      allIngredients: Array<{
        ingredientName: string;
        availableQuantity: number;
        requiredPerServing: number;
        unit: string;
        maxServingsFromThisIngredient: number;
      }>;
    }>;
    overallStats: {
      totalMenuItems: number;
      availableItems: number;
      unavailableItems: number;
      lowCapacityItems: number; // < 5 servings
    };
  }> {
    const menuItems = await MenuItem.findAll();
    const results = [];
    let availableItems = 0;
    let unavailableItems = 0;
    let lowCapacityItems = 0;

    for (const menuItem of menuItems) {
      const servingsResult = await InventoryService.calculateMaxServings(menuItem.id);
      
      // Get detailed ingredient information
      const allIngredients = [];
      for (const ingredient of menuItem.ingredients) {
        const inventoryItem = await InventoryItem.findById(ingredient.inventoryItemId);
        if (inventoryItem) {
          const maxFromThisIngredient = Math.floor(inventoryItem.quantity / ingredient.quantity);
          allIngredients.push({
            ingredientName: ingredient.ingredientName,
            availableQuantity: inventoryItem.quantity,
            requiredPerServing: ingredient.quantity,
            unit: ingredient.quantityUnit,
            maxServingsFromThisIngredient: maxFromThisIngredient
          });
        }
      }

      results.push({
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        maxOrdersPossible: servingsResult.maxServings,
        limitingIngredient: servingsResult.limitingIngredient?.ingredientName,
        limitingIngredientDetails: servingsResult.limitingIngredient ? {
          ingredientName: servingsResult.limitingIngredient.ingredientName,
          availableQuantity: servingsResult.limitingIngredient.availableQuantity,
          requiredPerServing: servingsResult.limitingIngredient.requiredQuantity,
          unit: servingsResult.limitingIngredient.quantityUnit
        } : undefined,
        allIngredients
      });

      if (servingsResult.maxServings === 0) {
        unavailableItems++;
      } else if (servingsResult.maxServings < 5) {
        lowCapacityItems++;
        availableItems++;
      } else {
        availableItems++;
      }
    }

    return {
      menuItems: results,
      overallStats: {
        totalMenuItems: menuItems.length,
        availableItems,
        unavailableItems,
        lowCapacityItems
      }
    };
  }

  // Rollback an order by adding back the used ingredients
  static async rollbackOrder(orderDetails: OrderResult['orderDetails']): Promise<{
    success: boolean;
    message: string;
    error?: any;
  }> {
    if (!orderDetails) {
      return {
        success: false,
        message: 'No order details provided for rollback'
      };
    }

    try {
      for (const ingredient of orderDetails.ingredientsUsed) {
        await InventoryItem.addQuantity(
          ingredient.inventoryItemId,
          ingredient.quantityUsed
        );
      }

      return {
        success: true,
        message: 'Order rolled back successfully'
      };
    } catch (error) {
      logError('Order rollback failed', error);
      return {
        success: false,
        message: getSimpleErrorMessage(error),
        error
      };
    }
  }

  // Process an order with automatic rollback on partial failure
  static async processOrderWithRollback(menuItemId: number): Promise<OrderResult> {
    const result = await this.processOrder(menuItemId);
    
    // If order failed but some ingredients might have been deducted,
    // attempt to rollback
    if (!result.success && result.orderDetails) {
      console.log('Order failed, attempting rollback...');
      const rollbackResult = await this.rollbackOrder(result.orderDetails);
      
      if (!rollbackResult.success) {
        // Rollback also failed - this is a serious issue
        result.message += ' (Warning: Rollback failed)';
      }
    }
    
    return result;
  }
} 