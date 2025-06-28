import InventoryItem from '@/models/inventory-item';
import MenuItem from '@/models/menu-item';
import MenuItemIngredient from '@/models/menu-item-ingredients';
import { logError, getSimpleErrorMessage } from './error-handler';

export interface IngredientAvailability {
  inventoryItemId: number;
  ingredientName: string;
  requiredQuantity: number;
  availableQuantity: number;
  quantityUnit: string;
  isAvailable: boolean;
  shortfall: number;
}

export interface OrderAvailabilityResult {
  canFulfillOrder: boolean;
  menuItemName: string;
  ingredientChecks: IngredientAvailability[];
  unavailableIngredients: IngredientAvailability[];
  errorMessage?: string;
  error?: any;
}

export class InventoryService {
  // Check if a menu item can be fulfilled based on current inventory
  static async checkOrderAvailability(menuItemId: number): Promise<OrderAvailabilityResult> {
    try {
      // Get the menu item with its ingredients
      const menuItem = await MenuItem.findById(menuItemId);
      if (!menuItem) {
        logError(`Menu item not found: ${menuItemId}`);
        return {
          canFulfillOrder: false,
          menuItemName: 'Unknown Item',
          ingredientChecks: [],
          unavailableIngredients: [],
          errorMessage: 'Menu item not found',
          error: new Error(`Menu item with ID ${menuItemId} not found`)
        };
      }

      // Check availability for each ingredient
      const ingredientChecks: IngredientAvailability[] = [];
      const unavailableIngredients: IngredientAvailability[] = [];

      for (const ingredient of menuItem.ingredients) {
        const inventoryItem = await InventoryItem.findById(ingredient.inventoryItemId);
        
        if (!inventoryItem) {
          const unavailableCheck: IngredientAvailability = {
            inventoryItemId: ingredient.inventoryItemId,
            ingredientName: ingredient.ingredientName,
            requiredQuantity: ingredient.quantity,
            availableQuantity: 0,
            quantityUnit: ingredient.quantityUnit,
            isAvailable: false,
            shortfall: ingredient.quantity
          };
          ingredientChecks.push(unavailableCheck);
          unavailableIngredients.push(unavailableCheck);
          continue;
        }

        // Validate sufficient stock for this ingredient
        const validation = inventoryItem.validateSufficientStock(ingredient.quantity);
        
        const availabilityCheck: IngredientAvailability = {
          inventoryItemId: ingredient.inventoryItemId,
          ingredientName: ingredient.ingredientName,
          requiredQuantity: ingredient.quantity,
          availableQuantity: validation.availableQuantity,
          quantityUnit: ingredient.quantityUnit,
          isAvailable: validation.isAvailable,
          shortfall: validation.shortfall
        };

        ingredientChecks.push(availabilityCheck);
        
        if (!validation.isAvailable) {
          unavailableIngredients.push(availabilityCheck);
        }
      }

      const canFulfillOrder = unavailableIngredients.length === 0;
      
      return {
        canFulfillOrder,
        menuItemName: menuItem.name,
        ingredientChecks,
        unavailableIngredients,
        errorMessage: canFulfillOrder ? undefined : this.generateUnavailabilityMessage(menuItem.name, unavailableIngredients)
      };

    } catch (error) {
      logError('Failed to check order availability', error);
      return {
        canFulfillOrder: false,
        menuItemName: 'Unknown Item',
        ingredientChecks: [],
        unavailableIngredients: [],
        errorMessage: getSimpleErrorMessage(error),
        error
      };
    }
  }

  // Check availability for multiple menu items
  static async checkMultipleOrdersAvailability(menuItemIds: number[]): Promise<OrderAvailabilityResult[]> {
    const results: OrderAvailabilityResult[] = [];
    
    for (const menuItemId of menuItemIds) {
      const result = await this.checkOrderAvailability(menuItemId);
      results.push(result);
    }
    
    return results;
  }

  // Get current inventory summary
  static async getInventorySummary(): Promise<{
    inventoryItems: InventoryItem[];
    lowStockItems: InventoryItem[];
    outOfStockItems: InventoryItem[];
    error?: any;
  }> {
    try {
      const inventoryItems = await InventoryItem.findAll();
      const lowStockItems = inventoryItems.filter(item => item.isLowStock(50000)); // Low if less than 50g/50ml
      const outOfStockItems = inventoryItems.filter(item => item.isOutOfStock());

      return {
        inventoryItems,
        lowStockItems,
        outOfStockItems
      };
    } catch (error) {
      logError('Failed to get inventory summary', error);
      return {
        inventoryItems: [],
        lowStockItems: [],
        outOfStockItems: [],
        error
      };
    }
  }

  // Calculate how many servings of a menu item can be made with current inventory
  static async calculateMaxServings(menuItemId: number): Promise<{
    maxServings: number;
    limitingIngredient?: IngredientAvailability;
    menuItemName: string;
    error?: any;
  }> {
    try {
      const menuItem = await MenuItem.findById(menuItemId);
      if (!menuItem) {
        return {
          maxServings: 0,
          menuItemName: 'Unknown Item'
        };
      }

      let maxServings = Number.MAX_SAFE_INTEGER;
      let limitingIngredient: IngredientAvailability | undefined;

      for (const ingredient of menuItem.ingredients) {
        const inventoryItem = await InventoryItem.findById(ingredient.inventoryItemId);
        
        if (!inventoryItem) {
          return {
            maxServings: 0,
            limitingIngredient: {
              inventoryItemId: ingredient.inventoryItemId,
              ingredientName: ingredient.ingredientName,
              requiredQuantity: ingredient.quantity,
              availableQuantity: 0,
              quantityUnit: ingredient.quantityUnit,
              isAvailable: false,
              shortfall: ingredient.quantity
            },
            menuItemName: menuItem.name
          };
        }

        const possibleServings = Math.floor(inventoryItem.quantity / ingredient.quantity);
        
        if (possibleServings < maxServings) {
          maxServings = possibleServings;
          limitingIngredient = {
            inventoryItemId: ingredient.inventoryItemId,
            ingredientName: ingredient.ingredientName,
            requiredQuantity: ingredient.quantity,
            availableQuantity: inventoryItem.quantity,
            quantityUnit: ingredient.quantityUnit,
            isAvailable: possibleServings > 0,
            shortfall: possibleServings > 0 ? 0 : ingredient.quantity - inventoryItem.quantity
          };
        }
      }

      return {
        maxServings: maxServings === Number.MAX_SAFE_INTEGER ? 0 : maxServings,
        limitingIngredient,
        menuItemName: menuItem.name
      };

    } catch (error) {
      logError('Failed to calculate max servings', error);
      return {
        maxServings: 0,
        menuItemName: 'Unknown Item',
        error
      };
    }
  }

  // Generate error message for unavailable ingredients
  private static generateUnavailabilityMessage(menuItemName: string, unavailableIngredients: IngredientAvailability[]): string {
    if (unavailableIngredients.length === 1) {
      const ingredient = unavailableIngredients[0];
      return `Not enough ${ingredient.ingredientName} for ${menuItemName}. Required: ${ingredient.requiredQuantity}${ingredient.quantityUnit}, Available: ${ingredient.availableQuantity}${ingredient.quantityUnit}.`;
    } else {
      const ingredientNames = unavailableIngredients.map(ing => ing.ingredientName).join(', ');
      return `Not enough ingredients for ${menuItemName}. Missing: ${ingredientNames}.`;
    }
  }

  // Check availability for a single ingredient
  static async checkSingleIngredientAvailability(
    inventoryItemId: number, 
    requiredQuantity: number
  ): Promise<IngredientAvailability> {
    try {
      const inventoryItem = await InventoryItem.findById(inventoryItemId);
      
      if (!inventoryItem) {
        return {
          inventoryItemId,
          ingredientName: 'Unknown Ingredient',
          requiredQuantity,
          availableQuantity: 0,
          quantityUnit: 'unknown',
          isAvailable: false,
          shortfall: requiredQuantity
        };
      }

      const validation = inventoryItem.validateSufficientStock(requiredQuantity);
      
      return {
        inventoryItemId,
        ingredientName: inventoryItem.name,
        requiredQuantity,
        availableQuantity: validation.availableQuantity,
        quantityUnit: inventoryItem.quantityUnit,
        isAvailable: validation.isAvailable,
        shortfall: validation.shortfall
      };

    } catch (error) {
      logError('Failed to check ingredient availability', error);
      return {
        inventoryItemId,
        ingredientName: 'Unknown Ingredient',
        requiredQuantity,
        availableQuantity: 0,
        quantityUnit: 'unknown',
        isAvailable: false,
        shortfall: requiredQuantity
      };
    }
  }
} 