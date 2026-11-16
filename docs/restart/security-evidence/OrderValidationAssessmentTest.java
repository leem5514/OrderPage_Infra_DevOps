package com.example.ordersystem.securityassessment;

import com.example.ordersystem.ordering.controller.OrderController;
import com.example.ordersystem.ordering.domain.Ordering;
import com.example.ordersystem.ordering.dto.OrderSaveReqDto;
import com.example.ordersystem.ordering.service.OrderingService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Assessment only: isolates MVC binding; no real DB, inventory, AWS or HTTP server.
class OrderValidationAssessmentTest {
    @Test
    void negativeQuantityReachesBusinessServiceDespitePositiveAnnotation() throws Exception {
        OrderingService service=mock(OrderingService.class);
        Ordering order=mock(Ordering.class);
        when(order.getId()).thenReturn(1L);
        when(service.orderCreate(anyList())).thenReturn(order);
        MockMvcBuilders.standaloneSetup(new OrderController(service)).build()
            .perform(post("/order/create").contentType(MediaType.APPLICATION_JSON)
                .content("[{\"productId\":1,\"productCount\":-1}]"))
            .andExpect(status().isCreated());
        ArgumentCaptor<List> items=ArgumentCaptor.forClass(List.class);
        verify(service).orderCreate(items.capture());
        assertEquals(-1,((OrderSaveReqDto)items.getValue().get(0)).getProductCount());
    }
}
